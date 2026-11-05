use crate::client::{restart_heybox_if_was_running, stop_if_running};
use crate::userdata;
use crate::constants::{
    BACKUP_DIR, HTML_MARKER, HTML_SNIPPET, INDEX_SNIPPET, LOADER_VERSION, MANIFEST_FILE,
    MARKER_BEGIN, MARKER_END, PRELOAD_SNIPPET, SUPPORTED_CLIENT_RANGE,
    is_supported_client_version,
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
    if is_supported_client_version(version) {
        Ok(())
    } else {
        Err(format!(
            "客户端版本 {version} 不在支持范围内。支持范围：{SUPPORTED_CLIENT_RANGE}"
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
    with_client_restart(install, || install_patches(install), "安装", true)
}

pub fn reinstall_patches_managed(install: &ClientInstall) -> Result<String, String> {
    with_client_restart(install, || reinstall_patches(install), "重装", true)
}

pub fn uninstall_patches_managed(install: &ClientInstall) -> Result<String, String> {
    let app_dir = normalize_path(&install.app_dir);
    with_client_restart(install, || uninstall_patches(&app_dir), "卸载", false)
}

fn with_client_restart(
    install: &ClientInstall,
    operation: impl FnOnce() -> Result<(), String>,
    action_label: &str,
    restore_session: bool,
) -> Result<String, String> {
    let was_running = stop_if_running()?;
    operation()?;
    if was_running && restore_session {
        userdata::write_session_restore_intent();
    }
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

/// include_dir 给出的路径相对 runtime 根（例如 `lib/storage.js`），只能拼到部署根。
fn embedded_out_path(deploy_root: &Path, file_rel: &Path) -> PathBuf {
    deploy_root.join(file_rel)
}

#[cfg(not(debug_assertions))]
fn write_embedded_dir(dir: &Dir<'_>, deploy_root: &Path) -> Result<(), String> {
    for entry in dir.entries() {
        match entry {
            include_dir::DirEntry::Dir(sub) => {
                write_embedded_dir(sub, deploy_root)?;
            }
            include_dir::DirEntry::File(file) => {
                let out_path = embedded_out_path(deploy_root, file.path());
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

    if relative_path.ends_with("index.html") {
        return restore_index_html(&app_dir, &target_path, &backup_path);
    }

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

/// 官方热更新会换掉 `index.html` 引用的入口文件并删掉旧文件，`.backup` 仍是安装当时的页面。
/// 备份里的本地脚本/样式已经不在、当前页面引用的文件还在时，保留当前页面并去掉注入。
fn restore_index_html(app_dir: &Path, target_path: &Path, backup_path: &Path) -> Result<(), String> {
    let live = if target_path.is_file() {
        Some(fs::read_to_string(target_path).map_err(io_err)?)
    } else {
        None
    };

    if backup_path.is_file() {
        let backup = fs::read_to_string(backup_path).map_err(io_err)?;
        let live_official = live.as_deref().map(html_without_snippet);
        if prefer_html_backup(&backup, live_official.as_deref(), app_dir) {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(io_err)?;
            }
            fs::copy(backup_path, target_path).map_err(io_err)?;
            return Ok(());
        }
    }

    if let Some(content) = live {
        if content.contains(HTML_MARKER) {
            fs::write(target_path, html_without_snippet(&content)).map_err(io_err)?;
        }
    }
    Ok(())
}

fn html_without_snippet(content: &str) -> String {
    content.replace(HTML_SNIPPET, "")
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum HtmlAssetState {
    /// 没有可判断的本地相对路径。
    Uncheckable,
    Present,
    Missing,
}

fn prefer_html_backup(backup: &str, live_official: Option<&str>, app_dir: &Path) -> bool {
    if html_asset_state(app_dir, backup) != HtmlAssetState::Missing {
        return true;
    }
    match live_official {
        Some(live) if html_asset_state(app_dir, live) == HtmlAssetState::Present => false,
        _ => true,
    }
}

fn html_asset_state(app_dir: &Path, html: &str) -> HtmlAssetState {
    let refs = html_local_asset_refs(html);
    if refs.is_empty() {
        return HtmlAssetState::Uncheckable;
    }
    let webapp = app_dir.join("webapp");
    for rel in refs {
        if !webapp.join(rel).is_file() {
            return HtmlAssetState::Missing;
        }
    }
    HtmlAssetState::Present
}

fn html_local_asset_refs(html: &str) -> Vec<String> {
    let mut refs = Vec::new();
    for attr in ["src", "href"] {
        for value in html_attr_values(html, attr) {
            if let Some(rel) = local_webapp_asset(&value) {
                refs.push(rel);
            }
        }
    }
    refs
}

fn local_webapp_asset(value: &str) -> Option<String> {
    let value = value.trim();
    let path = value.split(['?', '#']).next().unwrap_or(value);
    if path.is_empty()
        || path.starts_with('#')
        || path.starts_with('/')
        || path.starts_with("//")
        || path.contains("://")
        || path.contains("..")
    {
        return None;
    }
    Some(path.replace('/', std::path::MAIN_SEPARATOR_STR))
}

fn html_attr_values(html: &str, attr: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let key = format!("{attr}=");
    let bytes = html.as_bytes();
    let mut values = Vec::new();
    let mut start = 0;
    while let Some(rel) = lower[start..].find(&key) {
        let at = start + rel;
        let preceded_ok = at == 0 || bytes[at - 1].is_ascii_whitespace();
        let mut i = at + key.len();
        if !preceded_ok {
            start = i;
            continue;
        }
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || (bytes[i] != b'"' && bytes[i] != b'\'') {
            start = i;
            continue;
        }
        let quote = bytes[i];
        i += 1;
        let value_start = i;
        while i < bytes.len() && bytes[i] != quote {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        values.push(html[value_start..i].to_string());
        start = i + 1;
    }
    values
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

    fn fixture(name: &str) -> PathBuf {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../.tmp-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("webapp/js")).unwrap();
        fs::create_dir_all(root.join("betterheyboxchat/.backup/webapp")).unwrap();
        root
    }

    fn page(script: &str) -> String {
        format!(r#"<html><head><script defer="defer" src="{script}"></script></head><body></body></html>"#)
    }

    #[test]
    fn restore_keeps_hotfixed_html_when_backup_assets_are_gone() {
        let app = fixture("patch-html-stale");
        fs::write(app.join("webapp/js/new.js"), "new").unwrap();
        let live = format!("<head>{}{}", HTML_SNIPPET, page("js/new.js").trim_start_matches("<html><head>"));
        let live = format!("<html>{live}");
        fs::write(app.join("webapp/index.html"), &live).unwrap();
        fs::write(
            app.join("betterheyboxchat/.backup/webapp/index.html"),
            page("js/old.js"),
        )
        .unwrap();

        restore_file(&app, Path::new("webapp/index.html")).unwrap();
        let restored = fs::read_to_string(app.join("webapp/index.html")).unwrap();
        assert!(restored.contains("js/new.js"), "{restored}");
        assert!(!restored.contains("js/old.js"), "{restored}");
        assert!(!restored.contains(HTML_MARKER), "{restored}");
        fs::remove_dir_all(&app).unwrap();
    }

    #[test]
    fn restore_uses_backup_when_its_assets_still_exist() {
        let app = fixture("patch-html-fresh");
        fs::write(app.join("webapp/js/old.js"), "old").unwrap();
        fs::write(app.join("webapp/js/new.js"), "new").unwrap();
        fs::write(app.join("webapp/index.html"), page("js/new.js")).unwrap();
        fs::write(
            app.join("betterheyboxchat/.backup/webapp/index.html"),
            page("js/old.js"),
        )
        .unwrap();

        restore_file(&app, Path::new("webapp/index.html")).unwrap();
        let restored = fs::read_to_string(app.join("webapp/index.html")).unwrap();
        assert!(restored.contains("js/old.js"), "{restored}");
        assert!(!restored.contains("js/new.js"), "{restored}");
        fs::remove_dir_all(&app).unwrap();
    }
}
