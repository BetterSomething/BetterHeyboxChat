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

pub const SUPPORTED_CLIENT_VERSIONS: &[&str] = &["1.56.0", "1.57.0"];

pub const HEYBOX_DISPLAY_NAME_HINTS: &[&str] =
    &["heybox", "黑盒语音", "黑盒", "heybox chat"];

pub const MANIFEST_FILE: &str = "install.json";
pub const BACKUP_DIR: &str = ".backup";
