pub const LOADER_VERSION: &str = "0.1.0";

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

pub const DEFAULT_INSTALL_CANDIDATES: &[&str] = &[
    r"C:\Program Files\Qingfeng\HeyboxChat",
    r"C:\Program Files (x86)\Qingfeng\HeyboxChat",
    r"D:\Program Files\Qingfeng\HeyboxChat",
];

pub const HEYBOX_DISPLAY_NAME_HINTS: &[&str] =
    &["heybox", "黑盒语音", "黑盒", "heybox chat"];

pub const MANIFEST_FILE: &str = "install.json";
pub const BACKUP_DIR: &str = ".backup";
