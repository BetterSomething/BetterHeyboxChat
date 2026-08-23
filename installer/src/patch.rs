use crate::client::{restart_heybox_if_was_running, stop_if_running};
use crate::constants::{
    BACKUP_DIR, HTML_MARKER, HTML_SNIPPET, INDEX_SNIPPET, LOADER_VERSION, MANIFEST_FILE,
    MARKER_BEGIN, MARKER_END, PRELOAD_SNIPPET, SUPPORTED_CLIENT_VERSIONS,
};
use crate::path_util::normalize_path;
use crate::types::{ClientInstall, InstallManifest, PatchState};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[cfg(not(debug_assertions))]
use include_dir::{include_dir, Dir};

#[cfg(not(debug_assertions))]
static RUNTIME_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../runtime");

pub fn read_patch_state(app_dir: &Path) -> PatchState {
    let app_dir = normalize_path(app_dir);
    let preload_path = app_dir.join("source/preload/index.js");
    let html_path = app_dir.join("webapp/index.html");
    let runtime_dir = app_dir.join("betterheyboxchat");
    let manifest_path = runtime_dir.join(MANIFEST_FILE);

    let preload_patched = fs::read_to_string(&preload_path)
        .map(|c| c.contains(MARKER_BEGIN))
        .unwrap_or(false);
    let html_patched = fs::read_to_string(&html_path)
        .map(|c| c.contains(HTML_MARKER))
        .unwrap_or(false);
    let runtime_present = runtime_dir.join("loader.js").is_file();

    let mut state = PatchState {
        installed: preload_patched && html_patched && runtime_present,
        preload_patched,
        html_patched,
        runtime_present,
        ..Default::default()
    };

    if let Ok(content) = fs::read_to_string(&manifest_path) {
        if let Ok(manifest) = serde_json::from_str::<InstallManifest>(&content) {
            state.loader_version = Some(manifest.loader_version);
            state.installed_at = Some(manifest.installed_at);
            state.client_version = Some(manifest.client_version);
        }
    }

    state
}

pub fn assert_client_supported(version: &str) -> Result<(), String> {
    if SUPPORTED_CLIENT_VERSIONS.contains(&version) {
        Ok(())
    } else {
        Err(format!(
            "客户端版本 {version} 暂未纳入兼容表。当前支持: {}",
            SUPPORTED_CLIENT_VERSIONS.join(", ")
        ))
    }
}

pub fn install_patches(install: &ClientInstall) -> Result<(), String> {
    assert_client_supported(&install.version)?;

    let app_dir = normalize_path(&install.app_dir);
    let state = read_patch_state(&app_dir);
    if state.installed {
        return Err("BetterHeyboxChat 已安装。请使用「重装/更新」。".into());
    }

    let runtime_dir = app_dir.join("betterheyboxchat");
    fs::create_dir_all(runtime_dir.join(BACKUP_DIR)).map_err(io_err)?;

    let mut backed_up_files = Vec::new();
    patch_preload(&app_dir, &mut backed_up_files)?;
    patch_index_html(&app_dir, &mut backed_up_files)?;
    patch_index_js(&app_dir, &mut backed_up_files)?;
    ensure_env_prod(&app_dir, &mut backed_up_files)?;
    deploy_runtime(&app_dir)?;

    let manifest = InstallManifest {
        loader_version: LOADER_VERSION.to_string(),
        installed_at: chrono::Local::now().to_rfc3339(),
        client_version: install.version.clone(),
        install_root: normalize_path(&install.install_root).display().to_string(),
        app_dir: app_dir.display().to_string(),
        backed_up_files,
    };

    fs::write(
        runtime_dir.join(MANIFEST_FILE),
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(io_err)?;

    Ok(())
}

pub fn install_patches_managed(install: &ClientInstall) -> Result<String, String> {
    with_client_restart(install, || install_patches(install), "安装")
}

pub fn reinstall_patches_managed(install: &ClientInstall) -> Result<String, String> {
    with_client_restart(install, || reinstall_patches(install), "重装")
}

pub fn uninstall_patches_managed(install: &ClientInstall) -> Result<String, String> {
    let app_dir = normalize_path(&install.app_dir);
    with_client_restart(install, || uninstall_patches(&app_dir), "卸载")
}

fn with_client_restart(
    install: &ClientInstall,
    operation: impl FnOnce() -> Result<(), String>,
    action_label: &str,
) -> Result<String, String> {
    let was_running = stop_if_running()?;
    operation()?;
    restart_heybox_if_was_running(install, was_running)?;

    if was_running {
        Ok(format!("{action_label}成功！已自动重启黑盒语音。"))
    } else {
        Ok(format!("{action_label}成功！请启动黑盒语音验证。"))
    }
}

pub fn reinstall_patches(install: &ClientInstall) -> Result<(), String> {
    let app_dir = normalize_path(&install.app_dir);
    let _ = uninstall_patches(&app_dir);
    install_patches(install)
}

pub fn uninstall_patches(app_dir: &Path) -> Result<(), String> {
    let app_dir = normalize_path(app_dir);
    let state = read_patch_state(&app_dir);
    if !state.installed
        && !state.preload_patched
        && !state.html_patched
        && !state.runtime_present
    {
        return Err("未检测到 BetterHeyboxChat 安装。".into());
    }

    restore_file(&app_dir, Path::new("source/preload/index.js"))?;
    restore_file(&app_dir, Path::new("webapp/index.html"))?;
    restore_file(&app_dir, Path::new("index.js"))?;
    restore_env_js(&app_dir)?;

    let runtime_dir = app_dir.join("betterheyboxchat");
    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir).map_err(io_err)?;
    }

    Ok(())
}

fn patch_preload(app_dir: &Path, backed_up_files: &mut Vec<String>) -> Result<(), String> {
    let app_dir = normalize_path(app_dir);
    let file_path = app_dir.join("source/preload/index.js");
    let original = fs::read_to_string(&file_path).map_err(io_err)?;

    if original.contains(MARKER_BEGIN) {
        return Err("preload/index.js 已包含 BetterHeyboxChat 标记。".into());
    }

    backup_file(&app_dir, &file_path, backed_up_files)?;
    let patched = format!("{}\n\n{}\n", original.trim_end(), PRELOAD_SNIPPET);
    fs::write(&file_path, patched).map_err(io_err)?;
    Ok(())
}

fn patch_index_js(app_dir: &Path, backed_up_files: &mut Vec<String>) -> Result<(), String> {
    let app_dir = normalize_path(app_dir);
    let file_path = app_dir.join("index.js");
    if !file_path.is_file() {
        return Ok(());
    }

    let original = fs::read_to_string(&file_path).map_err(io_err)?;
    if original.contains(MARKER_BEGIN) {
        return Err("index.js 已包含 BetterHeyboxChat 标记。".into());
    }

    backup_file(&app_dir, &file_path, backed_up_files)?;
    let patched = format!("{INDEX_SNIPPET}\n\n{original}");
    fs::write(&file_path, patched).map_err(io_err)?;
    Ok(())
}

fn ensure_env_prod(app_dir: &Path, backed_up_files: &mut Vec<String>) -> Result<(), String> {
    let app_dir = normalize_path(app_dir);
    let file_path = app_dir.join("env.js");
    if !file_path.is_file() {
        return Ok(());
    }

    let original = fs::read_to_string(&file_path).map_err(io_err)?;
    if !original.contains("ELECTRON_ENV: 'local'") {
        return Ok(());
    }

    backup_file(&app_dir, &file_path, backed_up_files)?;
    let patched = original.replace("ELECTRON_ENV: 'local'", "ELECTRON_ENV: 'prod'");
    fs::write(&file_path, patched).map_err(io_err)?;
    Ok(())
}

fn patch_index_html(app_dir: &Path, backed_up_files: &mut Vec<String>) -> Result<(), String> {
    let app_dir = normalize_path(app_dir);
    let file_path = app_dir.join("webapp/index.html");
    let original = fs::read_to_string(&file_path).map_err(io_err)?;

    if original.contains(HTML_MARKER) {
        return Err("webapp/index.html 已包含 BetterHeyboxChat 标记。".into());
    }

    backup_file(&app_dir, &file_path, backed_up_files)?;

    let injected = if original.contains("<head>") {
        original.replace("<head>", &format!("<head>{HTML_SNIPPET}"))
    } else {
        format!("{HTML_SNIPPET}{original}")
    };

    fs::write(&file_path, injected).map_err(io_err)?;
    Ok(())
}

fn deploy_runtime(app_dir: &Path) -> Result<(), String> {
    let target_dir = normalize_path(app_dir).join("betterheyboxchat");
    fs::create_dir_all(&target_dir).map_err(io_err)?;

    #[cfg(debug_assertions)]
    {
        let source = resolve_runtime_source_dir()?;
        copy_dir_recursive(&source, &target_dir)?;
    }

    #[cfg(not(debug_assertions))]
    write_embedded_dir(&RUNTIME_DIR, &target_dir)?;

    Ok(())
}

#[cfg(debug_assertions)]
fn resolve_runtime_source_dir() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [manifest_dir.join("../runtime")];

    for candidate in candidates {
        let dir = normalize_path(&candidate);
        if dir.join("loader.js").is_file() {
            return Ok(dir);
        }
    }

    Err("找不到 runtime 目录（debug 模式从 installer/../runtime 读取）。".into())
}

#[cfg(debug_assertions)]
fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!("runtime 源目录不存在: {}", source.display()));
    }

    for entry in fs::read_dir(source).map_err(io_err)? {
        let entry = entry.map_err(io_err)?;
        let src_path = entry.path();
        let dst_path = target.join(entry.file_name());

        if src_path.is_dir() {
            fs::create_dir_all(&dst_path).map_err(io_err)?;
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            if let Some(parent) = dst_path.parent() {
                fs::create_dir_all(parent).map_err(io_err)?;
            }
            fs::copy(&src_path, &dst_path).map_err(io_err)?;
        }
    }

    Ok(())
}

#[cfg(not(debug_assertions))]
fn write_embedded_dir(dir: &Dir<'_>, target: &Path) -> Result<(), String> {
    for entry in dir.entries() {
        match entry {
            include_dir::DirEntry::Dir(sub) => {
                write_embedded_dir(sub, &target.join(sub.path()))?;
            }
            include_dir::DirEntry::File(file) => {
                let out_path = target.join(file.path());
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(io_err)?;
                }
                fs::write(&out_path, file.contents()).map_err(io_err)?;
            }
        }
    }
    Ok(())
}

fn backup_file(
    app_dir: &Path,
    file_path: &Path,
    backed_up_files: &mut Vec<String>,
) -> Result<(), String> {
    let app_dir = normalize_path(app_dir);
    let file_path = normalize_path(file_path);
    let relative = file_path
        .strip_prefix(&app_dir)
        .map_err(|_| format!("无法计算相对路径: {} 相对于 {}", file_path.display(), app_dir.display()))?
        .to_path_buf();
    let backup_path = app_dir
        .join("betterheyboxchat")
        .join(BACKUP_DIR)
        .join(&relative);

    if let Some(parent) = backup_path.parent() {
        fs::create_dir_all(parent).map_err(io_err)?;
    }
    fs::copy(&file_path, &backup_path).map_err(io_err)?;
    backed_up_files.push(relative.display().to_string());
    Ok(())
}

fn restore_env_js(app_dir: &Path) -> Result<(), String> {
    let app_dir = normalize_path(app_dir);
    let target_path = app_dir.join("env.js");
    let backup_path = app_dir.join("betterheyboxchat").join(BACKUP_DIR).join("env.js");
    let content = if backup_path.is_file() {
        fs::read_to_string(&backup_path).map_err(io_err)?
    } else if target_path.is_file() {
        fs::read_to_string(&target_path).map_err(io_err)?
    } else {
        return Ok(());
    };
    fs::write(
        &target_path,
        content.replace("ELECTRON_ENV: 'local'", "ELECTRON_ENV: 'prod'"),
    )
    .map_err(io_err)?;
    Ok(())
}

fn restore_file(app_dir: &Path, relative_path: &Path) -> Result<(), String> {
    let app_dir = normalize_path(app_dir);
    let target_path = app_dir.join(relative_path);
    let backup_path = app_dir
        .join("betterheyboxchat")
        .join(BACKUP_DIR)
        .join(relative_path);

    if backup_path.is_file() {
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(io_err)?;
        }
        fs::copy(&backup_path, &target_path).map_err(io_err)?;
        return Ok(());
    }

    if !target_path.is_file() {
        return Ok(());
    }

    let content = fs::read_to_string(&target_path).map_err(io_err)?;
    let rel = relative_path.to_string_lossy();

    if (rel.ends_with("preload/index.js") || rel.ends_with("index.js")) && content.contains(MARKER_BEGIN)
    {
        let cleaned = remove_marked_block(&content, MARKER_BEGIN, MARKER_END);
        fs::write(&target_path, cleaned).map_err(io_err)?;
    } else if rel.ends_with("index.html") && content.contains(HTML_MARKER) {
        fs::write(&target_path, content.replace(HTML_SNIPPET, "")).map_err(io_err)?;
    } else if rel.ends_with("env.js") && content.contains("ELECTRON_ENV: 'local'") {
        fs::write(
            &target_path,
            content.replace("ELECTRON_ENV: 'local'", "ELECTRON_ENV: 'prod'"),
        )
        .map_err(io_err)?;
    }

    Ok(())
}

fn remove_marked_block(content: &str, begin: &str, end: &str) -> String {
    let Some(start) = content.find(begin) else {
        return content.to_string();
    };
    let Some(end_rel) = content[start..].find(end) else {
        return content.to_string();
    };
    let end_abs = start + end_rel + end.len();
    let before = content[..start].trim_end();
    let after = content[end_abs..].trim_start();
    if before.is_empty() {
        after.to_string()
    } else if after.is_empty() {
        format!("{before}\n")
    } else {
        format!("{before}\n\n{after}")
    }
}

fn io_err(err: io::Error) -> String {
    if err.kind() == io::ErrorKind::PermissionDenied {
        "权限不足，请以管理员身份运行安装器。".to_string()
    } else {
        err.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn read_patch_state_works_with_verbatim_app_dir() {
        let app_dir = PathBuf::from(
            r"D:\Program Files\Qingfeng\HeyboxChat\1.56.0\resources\versions\1.56.0\app",
        );
        if !app_dir.join("betterheyboxchat/loader.js").is_file() {
            return;
        }

        let canonical = fs::canonicalize(&app_dir).expect("canonicalize app dir");
        let state = read_patch_state(&canonical);
        assert!(
            state.installed,
            "verbatim app_dir should still detect installed patch (preload={}, html={}, runtime={})",
            state.preload_patched,
            state.html_patched,
            state.runtime_present
        );
    }
}
