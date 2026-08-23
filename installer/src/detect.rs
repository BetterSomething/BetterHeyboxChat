use crate::constants::{DEFAULT_INSTALL_CANDIDATES, HEYBOX_DISPLAY_NAME_HINTS};
use crate::path_util::normalize_path;
use crate::types::{ClientInstall, PackageJson};
use std::fs;
use std::path::{Path, PathBuf};
pub fn detect_install(manual_root: Option<&Path>) -> Option<ClientInstall> {
    let mut roots: Vec<PathBuf> = Vec::new();

    if let Some(root) = manual_root {
        roots.push(root.to_path_buf());
    } else {
        roots.extend(
            DEFAULT_INSTALL_CANDIDATES
                .iter()
                .map(|p| PathBuf::from(p)),
        );
        if let Some(registry_root) = find_registry_install_root() {
            roots.push(registry_root);
        }
    }

    let mut seen = std::collections::HashSet::new();
    for root in roots {
        let normalized = normalize_path(&root);
        if !seen.insert(normalized.clone()) {
            continue;
        }
        if let Some(install) = resolve_install_from_root(&normalized) {
            return Some(install);
        }
    }

    None
}

#[cfg(windows)]
fn find_registry_install_root() -> Option<PathBuf> {
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
            let install_location: String = app_key.get_value("InstallLocation").unwrap_or_default();

            if matches_heybox_name(&display_name) && !install_location.is_empty() {
                return Some(PathBuf::from(install_location));
            }
        }
    }

    None
}

#[cfg(not(windows))]
fn find_registry_install_root() -> Option<PathBuf> {
    None
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
