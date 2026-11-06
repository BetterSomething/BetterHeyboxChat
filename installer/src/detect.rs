use crate::constants::HEYBOX_DISPLAY_NAME_HINTS;
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

const PROGRAM_FILES_FOLDERS: &[&str] = &["Program Files", "Program Files (x86)"];

fn push_unique_path(out: &mut Vec<PathBuf>, path: PathBuf) {
    let key = path.to_string_lossy().to_lowercase();
    if !out
        .iter()
        .any(|existing| existing.to_string_lossy().to_lowercase() == key)
    {
        out.push(path);
    }
}

fn heybox_under(base: &Path) -> PathBuf {
    base.join("Qingfeng").join("HeyboxChat")
}

fn mounted_drive_letters() -> Vec<char> {
    #[cfg(windows)]
    {
        extern "system" {
            fn GetLogicalDrives() -> u32;
        }
        let mask = unsafe { GetLogicalDrives() };
        return (0..26)
            .filter(|i| mask & (1 << i) != 0)
            .map(|i| (b'A' + i) as char)
            .collect();
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// 扫本机已挂载盘符上的 `Program Files\Qingfeng\HeyboxChat`，再加上环境变量里的 Program Files。
pub fn program_files_heybox_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(base) = std::env::var_os(var).filter(|v| !v.is_empty()) {
            push_unique_path(&mut out, heybox_under(Path::new(&base)));
        }
    }
    for letter in mounted_drive_letters() {
        let drive = PathBuf::from(format!("{letter}:\\"));
        if !drive.is_dir() {
            continue;
        }
        for folder in PROGRAM_FILES_FOLDERS {
            push_unique_path(&mut out, heybox_under(&drive.join(folder)));
        }
    }
    out
}

/// 官方默认安装目录：`%LOCALAPPDATA%\Qingfeng\HeyboxChat`，其后是本机探测到的 Program Files。
pub fn default_install_fallbacks() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(local) = local_appdata_dir() {
        push_unique_path(&mut out, heybox_under(&local));
    }
    for candidate in program_files_heybox_candidates() {
        push_unique_path(&mut out, candidate);
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
    let versions_root = version_dir.join("resources").join("versions");

    // 官方热更新（整包替换）只改 resources/versions/ 下的目录，外层加载器目录不动：
    // 外层 1.60.0 + 内层 1.61.0 是常态。所以不假设内外同名，枚举 semver 目录取最高版。
    let mut inner_dirs: Vec<String> = fs::read_dir(&versions_root)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| is_semver(name))
        .collect();
    inner_dirs.sort_by(|a, b| compare_semver(a, b).reverse());

    let mut app_dir = None;
    let mut client_version = None;
    for inner in &inner_dirs {
        let candidate = versions_root.join(inner).join("app");
        let package_json_path = candidate.join("package.json");
        if !package_json_path.is_file() {
            continue;
        }
        let Ok(content) = fs::read_to_string(&package_json_path) else {
            continue;
        };
        let Ok(pkg) = serde_json::from_str::<PackageJson>(&content) else {
            continue;
        };
        if pkg.name != "heybox-chat-electron" {
            continue;
        }
        app_dir = Some(candidate);
        client_version = Some(pkg.version);
        break;
    }

    let app_dir = app_dir?;
    let client_version = client_version?;
    let electron_version = read_electron_version(&app_dir);

    Some(ClientInstall {
        install_root: normalize_path(install_root),
        version: if client_version.is_empty() {
            version.to_string()
        } else {
            client_version
        },
        version_dir: normalize_path(&version_dir),
        app_dir: normalize_path(&app_dir),
        package_name: "heybox-chat-electron".to_string(),
        electron_version,
    })
}

fn read_electron_version(app_dir: &Path) -> Option<String> {
    let content = fs::read_to_string(app_dir.join("package.json")).ok()?;
    let pkg: PackageJson = serde_json::from_str(&content).ok()?;
    pkg.dev_dependencies.get("electron").cloned()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_client(install_root: &Path, outer: &str, inner: &str, pkg_version: &str) {
        let app = install_root
            .join(outer)
            .join("resources")
            .join("versions")
            .join(inner)
            .join("app");
        fs::create_dir_all(&app).unwrap();
        fs::write(
            app.join("package.json"),
            format!(
                r#"{{"name":"heybox-chat-electron","version":"{pkg_version}","devDependencies":{{"electron":"43.4.1"}}}}"#
            ),
        )
        .unwrap();
    }

    #[test]
    fn hot_update_layout_inner_dir_differs_from_outer() {
        let tmp = std::env::temp_dir().join("bhchat-detect-test-hotupdate");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        // 官方热更新布局：外层加载器目录 1.60.0 不动，内层整包换成 1.61.0
        write_client(&tmp, "1.60.0", "1.61.0", "1.61.0");

        let install = resolve_install_from_root(&tmp).expect("应能识别热更新布局");
        assert_eq!(install.version, "1.61.0");
        assert!(install
            .app_dir
            .to_string_lossy()
            .ends_with(r"1.60.0\resources\versions\1.61.0\app"));
        assert_eq!(install.electron_version.as_deref(), Some("43.4.1"));

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn classic_layout_still_works() {
        let tmp = std::env::temp_dir().join("bhchat-detect-test-classic");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        // 旧布局：内外同名
        write_client(&tmp, "1.60.0", "1.60.0", "1.60.0");

        let install = resolve_install_from_root(&tmp).expect("应能识别传统同名布局");
        assert_eq!(install.version, "1.60.0");

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn picks_highest_inner_version_when_multiple() {
        let tmp = std::env::temp_dir().join("bhchat-detect-test-multi");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        write_client(&tmp, "1.60.0", "1.59.0", "1.59.0");
        write_client(&tmp, "1.60.0", "1.61.0", "1.61.0");
        // 未来的官方更新：目录名和 package.json 版本都超出当前已实测版本，
        // 探测逻辑不能假设任何版本上限。
        write_client(&tmp, "1.60.0", "2.3.4", "2.3.4");

        let install = resolve_install_from_root(&tmp).expect("应取内层最高版本");
        assert_eq!(install.version, "2.3.4");
        assert!(install
            .app_dir
            .to_string_lossy()
            .ends_with(r"1.60.0\resources\versions\2.3.4\app"));

        fs::remove_dir_all(&tmp).unwrap();
    }
}
