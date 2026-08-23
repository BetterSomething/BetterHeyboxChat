use std::fs;
use std::path::{Path, PathBuf};

/// 规范化路径：尽量 canonicalize，并去掉 Windows 扩展路径前缀 `\\?\`。
pub fn normalize_path(value: &Path) -> PathBuf {
    strip_extended_prefix(fs::canonicalize(value).unwrap_or_else(|_| value.to_path_buf()))
}

fn strip_extended_prefix(path: PathBuf) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_verbatim_prefix() {
        let input = PathBuf::from(r"\\?\D:\Program Files\HeyboxChat\app");
        let output = strip_extended_prefix(input);
        assert_eq!(output, Path::new(r"D:\Program Files\HeyboxChat\app"));
    }
}
