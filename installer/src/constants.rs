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

/// 黑盒客户端最低支持版本（含）。只有下限，不设上限：
/// 官方更新后只要探测出的版本不低于此值就允许安装，由运行时做能力探测降级。
pub const MIN_SUPPORTED_CLIENT_VERSION: &str = "1.56.0";

fn parse_client_version(version: &str) -> Option<Vec<u64>> {
    if version.is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    for part in version.split('.') {
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        parts.push(part.parse::<u64>().ok()?);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts)
    }
}

fn cmp_client_version(left: &[u64], right: &[u64]) -> std::cmp::Ordering {
    let len = left.len().max(right.len());
    for i in 0..len {
        let a = left.get(i).copied().unwrap_or(0);
        let b = right.get(i).copied().unwrap_or(0);
        match a.cmp(&b) {
            std::cmp::Ordering::Equal => {}
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

pub fn is_supported_client_version(version: &str) -> bool {
    let Some(current) = parse_client_version(version) else {
        return false;
    };
    let Some(min) = parse_client_version(MIN_SUPPORTED_CLIENT_VERSION) else {
        return false;
    };
    cmp_client_version(&current, &min) != std::cmp::Ordering::Less
}

pub const HEYBOX_DISPLAY_NAME_HINTS: &[&str] =
    &["heybox", "黑盒语音", "黑盒", "heybox chat"];

pub const MANIFEST_FILE: &str = "install.json";
pub const BACKUP_DIR: &str = ".backup";

#[cfg(test)]
mod tests {
    use super::is_supported_client_version;

    #[test]
    fn supported_range_has_only_a_lower_bound() {
        for version in [
            "1.56.0", "1.56.1", "1.57.1", "1.58.2", "1.60.0", "1.61.0", "1.61.1", "1.99.0",
            "2.0.0", "10.0.0",
        ] {
            assert!(is_supported_client_version(version), "{version} 应在支持范围内");
        }
        for version in ["1.55.9", "1.55.99", "0.9.9", "", "dev", "1.56.0-beta"] {
            assert!(
                !is_supported_client_version(version),
                "{version} 不应在支持范围内"
            );
        }
    }
}
