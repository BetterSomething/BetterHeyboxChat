pub const LOADER_VERSION: &str = env!("BHC_VERSION");
pub const LOADER_CHANNEL: &str = env!("BHC_CHANNEL");
#[allow(dead_code)]
pub const LOADER_COMMIT: &str = env!("BHC_COMMIT");

pub fn format_installer_label(version: &str, channel: &str) -> String {
    if channel == "release" {
        format!("安装器  v{version}")
    } else {
        format!("安装器  {version}")
    }
}

pub const MARKER_BEGIN: &str = "// BetterHeyboxChat:begin";
pub const MARKER_END: &str = "// BetterHeyboxChat:end";
pub const HTML_MARKER: &str = "<!-- BetterHeyboxChat:begin -->";

pub const PRELOAD_SNIPPET: &str = r"// BetterHeyboxChat:begin
try { require('../../betterheyboxchat/preload-bridge.js'); } catch (e) { console.error('[BetterHeyboxChat] preload bridge failed:', e); }
// BetterHeyboxChat:end";

pub const HTML_SNIPPET: &str = "<!-- BetterHeyboxChat:begin --><script src=\"../betterheyboxchat/webpack-hook.js\"></script><script src=\"../betterheyboxchat/loader.js\"></script>";

pub const INDEX_SNIPPET: &str = r"// BetterHeyboxChat:begin
try { require('./betterheyboxchat/main-bridge.js'); } catch (e) { console.error('[BetterHeyboxChat] main bridge failed:', e); }
// BetterHeyboxChat:end";

pub const SUPPORTED_CLIENT_VERSIONS: &[&str] = &["1.56.0"];

/// Program Files 常见路径。官方默认目录 `%LOCALAPPDATA%\Qingfeng\HeyboxChat` 由 `default_install_fallbacks` 动态补上。
pub const DEFAULT_INSTALL_CANDIDATES: &[&str] = &[
    r"C:\Program Files\Qingfeng\HeyboxChat",
    r"C:\Program Files (x86)\Qingfeng\HeyboxChat",
    r"D:\Program Files\Qingfeng\HeyboxChat",
];

pub const HEYBOX_DISPLAY_NAME_HINTS: &[&str] =
    &["heybox", "黑盒语音", "黑盒", "heybox chat"];

pub const MANIFEST_FILE: &str = "install.json";
pub const BACKUP_DIR: &str = ".backup";

#[cfg(test)]
mod tests {
    use super::format_installer_label;

    #[test]
    fn release_label_prefixes_v() {
        assert_eq!(format_installer_label("0.1.0", "release"), "安装器  v0.1.0");
    }

    #[test]
    fn dev_label_uses_raw_sha() {
        assert_eq!(format_installer_label("c357f16", "dev"), "安装器  c357f16");
    }
}
