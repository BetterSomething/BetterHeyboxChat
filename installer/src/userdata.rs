use crate::path_util::normalize_path;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const PROFILE_ENV: &str = "BETTERHEYBOXCHAT_PROFILE";
pub const DATA_ROOT_FILE: &str = "data-root.txt";
const APP_FOLDER: &str = "BetterHeyboxChat";

pub fn config_home() -> PathBuf {
    appdata_dir().join(APP_FOLDER)
}

pub fn default_data_root() -> PathBuf {
    config_home()
}

fn appdata_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(|p| PathBuf::from(p).join("AppData").join("Roaming"))
                .unwrap_or_else(|| PathBuf::from(r"C:\Users\Public\AppData\Roaming"))
        })
}

pub fn pointer_path() -> PathBuf {
    config_home().join(DATA_ROOT_FILE)
}

pub fn plugins_dir(data_root: &Path) -> PathBuf {
    data_root.join("plugins")
}

fn read_pointer_file() -> Option<PathBuf> {
    let text = fs::read_to_string(pointer_path()).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Some(normalize_path(&path))
    } else {
        None
    }
}

fn env_data_root() -> Option<PathBuf> {
    let value = std::env::var_os(PROFILE_ENV)?;
    if value.is_empty() {
        return None;
    }
    let path = PathBuf::from(value);
    if path.is_absolute() {
        Some(normalize_path(&path))
    } else {
        None
    }
}

pub const SESSION_RESTORE_INTENT: &str = "session-restore.intent";

pub fn write_session_restore_intent() {
    let root = current_data_root();
    let _ = fs::create_dir_all(&root);
    let _ = fs::write(root.join(SESSION_RESTORE_INTENT), "1");
}

pub fn current_data_root() -> PathBuf {
    env_data_root()
        .or_else(read_pointer_file)
        .unwrap_or_else(default_data_root)
}

pub fn validate_data_root(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("数据目录必须是绝对路径。".into());
    }
    let normalized = normalize_path(path);
    fs::create_dir_all(&normalized).map_err(io_err)?;
    fs::create_dir_all(plugins_dir(&normalized)).map_err(io_err)?;
    Ok(normalized)
}

pub fn write_pointer(path: &Path) -> Result<(), String> {
    let home = config_home();
    fs::create_dir_all(&home).map_err(io_err)?;
    fs::write(pointer_path(), path.display().to_string()).map_err(io_err)
}

pub fn clear_pointer() {
    let _ = fs::remove_file(pointer_path());
}

fn dir_is_empty(path: &Path) -> bool {
    match fs::read_dir(path) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => true,
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

pub fn maybe_migrate_plugins(old_root: &Path, new_root: &Path) -> Result<bool, String> {
    if normalize_path(old_root) == normalize_path(new_root) {
        return Ok(false);
    }
    let src = plugins_dir(old_root);
    let dst = plugins_dir(new_root);
    if !src.is_dir() {
        return Ok(false);
    }
    if dst.is_dir() && !dir_is_empty(&dst) {
        return Ok(false);
    }
    copy_dir_all(&src, &dst).map_err(io_err)?;
    Ok(true)
}

#[cfg(windows)]
fn set_user_env(value: Option<&str>) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let env = hkcu
        .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
        .map_err(|e| format!("写入用户环境变量失败: {e}"))?;
    match value {
        Some(v) => env
            .set_value(PROFILE_ENV, &v)
            .map_err(|e| format!("写入 {PROFILE_ENV} 失败: {e}")),
        None => {
            let _ = env.delete_value(PROFILE_ENV);
            Ok(())
        }
    }
}

#[cfg(windows)]
fn set_machine_env(value: Option<&str>) {
    use winreg::enums::*;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(env) = hklm.open_subkey_with_flags(
        r"System\CurrentControlSet\Control\Session Manager\Environment",
        KEY_READ | KEY_WRITE,
    ) else {
        return;
    };
    match value {
        Some(v) => {
            let _ = env.set_value(PROFILE_ENV, &v);
        }
        None => {
            let _ = env.delete_value(PROFILE_ENV);
        }
    }
}

#[cfg(not(windows))]
fn set_user_env(_value: Option<&str>) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn set_machine_env(_value: Option<&str>) {}

pub fn set_data_root(path: &Path) -> Result<PathBuf, String> {
    let old = current_data_root();
    let next = validate_data_root(path)?;
    write_pointer(&next)?;
    set_user_env(Some(&next.display().to_string()))?;
    set_machine_env(Some(&next.display().to_string()));
    std::env::set_var(PROFILE_ENV, next.as_os_str());
    let migrated = maybe_migrate_plugins(&old, &next)?;
    if migrated {
        Ok(next)
    } else {
        Ok(next)
    }
}

pub fn reset_data_root() -> Result<PathBuf, String> {
    clear_pointer();
    set_user_env(None)?;
    set_machine_env(None);
    std::env::remove_var(PROFILE_ENV);
    let root = default_data_root();
    validate_data_root(&root)
}

fn io_err(err: io::Error) -> String {
    err.to_string()
}
