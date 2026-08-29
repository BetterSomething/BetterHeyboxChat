use crate::constants::{DEFAULT_INSTALL_CANDIDATES, HEYBOX_DISPLAY_NAME_HINTS};
use crate::path_util::normalize_path;
use crate::types::{ClientInstall, PackageJson};
use std::fs;
use std::path::{Path, PathBuf};

pub fn local_appdata_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .filter(|v| !v.is_empty())
                .map(|p| PathBuf::from(p).join("AppData").join("Local"))
        })
}

/// 官方默认安装目录：`%LOCALAPPDATA%\Qingfeng\HeyboxChat`，其后是 Program Files 候选。
pub fn default_install_fallbacks() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(local) = local_appdata_dir() {
        out.push(local.join("Qingfeng").join("HeyboxChat"));
    }
    for candidate in DEFAULT_INSTALL_CANDIDATES {
        let path = PathBuf::from(*candidate);
        let key = path.to_string_lossy().to_lowercase();
        if !out.iter().any(|existing| existing.to_string_lossy().to_lowercase() == key) {
            out.push(path);
        }
    }
    out
}

pub fn detect_install(manual_root: Option<&Path>) -> Option<ClientInstall> {
    let registry_roots = find_registry_install_roots();
    let fallbacks = default_install_fallbacks();
    let roots = collect_candidate_roots(manual_root, &registry_roots, &fallbacks);

    let mut seen = std::collections::HashSet::new();
    for root in roots {
        let Some(install_root) = walk_to_install_root(&root) else {
            continue;
        };
        if !seen.insert(install_root.clone()) {
            continue;
        }
        if let Some(install) = resolve_install_from_root(&install_root) {
            return Some(install);
        }
    }

    None
}

pub(crate) fn collect_candidate_roots(
    manual_root: Option<&Path>,
    registry_roots: &[PathBuf],
    fallbacks: impl IntoIterator<Item = impl AsRef<Path>>,
) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(root) = manual_root {
        roots.push(root.to_path_buf());
    } else {
        roots.extend(registry_roots.iter().cloned());
        roots.extend(fallbacks.into_iter().map(|p| p.as_ref().to_path_buf()));
    }

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for root in roots {
        let key = root.to_string_lossy().to_lowercase();
        if seen.insert(key) {
            out.push(root);
        }
    }
    out
}

pub(crate) fn strip_icon_index(value: &str) -> String {
    let trimmed = value.trim().trim_matches('"').trim();
    if let Some(i) = trimmed.rfind(',') {
        let suffix = &trimmed[i + 1..];
        if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit() || c == '-') {
            return trimmed[..i].trim().trim_matches('"').to_string();
        }
    }
    trimmed.to_string()
}

pub(crate) fn looks_like_accelerator(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("加速") || lower.contains("accelerator") || lower.contains("heyboxacc")
}

pub(crate) fn walk_to_install_root(start: &Path) -> Option<PathBuf> {
    let mut cur = if start.is_file() {
        start.parent()?.to_path_buf()
    } else {
        start.to_path_buf()
    };
    for _ in 0..8 {
        if resolve_install_from_root(&cur).is_some() {
            return Some(normalize_path(&cur));
        }
        cur = cur.parent()?.to_path_buf();
    }
    None
}

fn push_inferred_root(roots: &mut Vec<PathBuf>, raw: &str) {
    if raw.trim().is_empty() {
        return;
    }
    let cleaned = strip_icon_index(raw);
    if let Some(root) = walk_to_install_root(Path::new(&cleaned)) {
        if !roots.iter().any(|existing| existing == &root) {
            roots.push(root);
        }
    }
}

#[cfg(windows)]
fn find_registry_install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    collect_app_path_roots(&mut roots);
    collect_uninstall_roots(&mut roots);
    roots
}

#[cfg(windows)]
fn collect_app_path_roots(roots: &mut Vec<PathBuf>) {
    use winreg::enums::*;
    use winreg::RegKey;

    let keys = [
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\HeyboxChat.exe",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\HeyboxChat.exe",
        ),
        (
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\HeyboxChat.exe",
        ),
    ];

    for (hive, subkey) in keys {
        let hk = RegKey::predef(hive);
        let Ok(app_key) = hk.open_subkey(subkey) else {
            continue;
        };
        let default_exe: String = app_key.get_value("").unwrap_or_default();
        let path_dir: String = app_key.get_value("Path").unwrap_or_default();
        push_inferred_root(roots, &default_exe);
        push_inferred_root(roots, &path_dir);
    }
}

#[cfg(windows)]
fn collect_uninstall_roots(roots: &mut Vec<PathBuf>) {
    use winreg::enums::*;
    use winreg::RegKey;

    let hives = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    for (hive, subkey) in hives {
        let hk = RegKey::predef(hive);
        let Ok(uninstall) = hk.open_subkey(subkey) else {
            continue;
        };

        for sub_name in uninstall.enum_keys().flatten() {
            let Ok(app_key) = uninstall.open_subkey(&sub_name) else {
                continue;
            };
            let display_name: String = app_key.get_value("DisplayName").unwrap_or_default();
            if !matches_heybox_name(&display_name) || looks_like_accelerator(&display_name) {
                continue;
            }
            let install_location: String = app_key.get_value("InstallLocation").unwrap_or_default();
            let display_icon: String = app_key.get_value("DisplayIcon").unwrap_or_default();
            push_inferred_root(roots, &install_location);
            push_inferred_root(roots, &display_icon);
        }
    }
}

#[cfg(not(windows))]
fn find_registry_install_roots() -> Vec<PathBuf> {
    Vec::new()
}

fn matches_heybox_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    HEYBOX_DISPLAY_NAME_HINTS
        .iter()
        .any(|hint| lower.contains(&hint.to_lowercase()))
}

fn resolve_install_from_root(install_root: &Path) -> Option<ClientInstall> {
    if !install_root.is_dir() {
        return None;
    }

    let mut version_dirs: Vec<String> = fs::read_dir(install_root)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| is_semver(name))
        .collect();

    version_dirs.sort_by(|a, b| compare_semver(a, b).reverse());

    for version in version_dirs {
        if let Some(install) = resolve_app_dir(install_root, &version) {
            return Some(install);
        }
    }

    None
}

fn is_semver(name: &str) -> bool {
    let parts: Vec<&str> = name.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| p.parse::<u32>().is_ok())
}

fn resolve_app_dir(install_root: &Path, version: &str) -> Option<ClientInstall> {
    let version_dir = install_root.join(version);
    let app_dir = version_dir
        .join("resources")
        .join("versions")
        .join(version)
        .join("app");
    let package_json_path = app_dir.join("package.json");

    if !package_json_path.is_file() {
        return None;
    }

    let content = fs::read_to_string(&package_json_path).ok()?;
    let pkg: PackageJson = serde_json::from_str(&content).ok()?;

    if pkg.name != "heybox-chat-electron" {
        return None;
    }

    let electron_version = pkg.dev_dependencies.get("electron").cloned();

    Some(ClientInstall {
        install_root: normalize_path(install_root),
        version: if pkg.version.is_empty() {
            version.to_string()
        } else {
            pkg.version
        },
        version_dir: normalize_path(&version_dir),
        app_dir: normalize_path(&app_dir),
        package_name: pkg.name,
        electron_version,
    })
}

fn compare_semver(a: &str, b: &str) -> std::cmp::Ordering {
    let pa: Vec<u32> = a.split('.').filter_map(|p| p.parse().ok()).collect();
    let pb: Vec<u32> = b.split('.').filter_map(|p| p.parse().ok()).collect();
    for i in 0..3 {
        let da = pa.get(i).copied().unwrap_or(0);
        let db = pb.get(i).copied().unwrap_or(0);
        match da.cmp(&db) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn strip_icon_index_removes_quoted_suffix() {
        assert_eq!(
            strip_icon_index(r#"D:\Program Files\Qingfeng\HeyboxChat\HeyboxChat.exe"#),
            r#"D:\Program Files\Qingfeng\HeyboxChat\HeyboxChat.exe"#
        );
        assert_eq!(
            strip_icon_index(r#""D:\Program Files\Qingfeng\HeyboxChat\HeyboxChat.exe",0"#),
            r#"D:\Program Files\Qingfeng\HeyboxChat\HeyboxChat.exe"#
        );
    }

    #[test]
    fn collect_roots_puts_registry_before_hardcoded() {
        let roots = collect_candidate_roots(
            None,
            &[PathBuf::from(r"D:\Program Files\Qingfeng\HeyboxChat")],
            &[
                r"C:\Program Files\Qingfeng\HeyboxChat",
                r"D:\Program Files\Qingfeng\HeyboxChat",
            ],
        );
        assert_eq!(roots[0], PathBuf::from(r"D:\Program Files\Qingfeng\HeyboxChat"));
        assert_eq!(roots.len(), 2);
    }

    #[test]
    fn collect_roots_manual_wins() {
        let roots = collect_candidate_roots(
            Some(Path::new(r"E:\Games\HeyboxChat")),
            &[PathBuf::from(r"D:\Program Files\Qingfeng\HeyboxChat")],
            &[r"C:\Program Files\Qingfeng\HeyboxChat"],
        );
        assert_eq!(roots, vec![PathBuf::from(r"E:\Games\HeyboxChat")]);
    }

    #[test]
    fn walk_to_install_root_from_launcher_exe() {
        let tmp = std::env::temp_dir().join(format!("bhchat-detect-{}", std::process::id()));
        let version = tmp.join("1.0.0");
        let app = version.join("resources").join("versions").join("1.0.0").join("app");
        fs::create_dir_all(&app).unwrap();
        let mut pkg = fs::File::create(app.join("package.json")).unwrap();
        pkg.write_all(br#"{"name":"heybox-chat-electron","version":"1.0.0"}"#)
            .unwrap();
        let exe = tmp.join("HeyboxChat.exe");
        fs::write(&exe, []).unwrap();

        let found = walk_to_install_root(&exe).expect("should infer install root from launcher exe");
        assert_eq!(found, normalize_path(&tmp));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn looks_like_accelerator_skips_heyboxacc() {
        assert!(looks_like_accelerator("黑盒加速器 1.1.84"));
        assert!(!looks_like_accelerator("黑盒语音 1.56.0"));
    }

    #[test]
    fn fallbacks_put_localappdata_qingfeng_first() {
        let local = std::env::var_os("LOCALAPPDATA")
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|p| PathBuf::from(p).join("AppData").join("Local").into_os_string())
            })
            .expect("LOCALAPPDATA or USERPROFILE");
        let expected = PathBuf::from(local).join("Qingfeng").join("HeyboxChat");
        let fallbacks = default_install_fallbacks();
        assert_eq!(
            fallbacks.first(),
            Some(&expected),
            "官方默认目录应排在 fallback 首位: %LOCALAPPDATA%\\Qingfeng\\HeyboxChat"
        );
        assert!(
            fallbacks
                .iter()
                .any(|p| p == Path::new(r"C:\Program Files\Qingfeng\HeyboxChat")),
            "仍应保留 Program Files 候选"
        );
    }
}

pub fn format_client_version(install: &ClientInstall) -> String {
    let arch = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        std::env::consts::ARCH
    };

    if let Some(electron) = &install.electron_version {
        format!("{} (Electron {}, {})", install.version, electron, arch)
    } else {
        format!("{} ({})", install.version, arch)
    }
}
