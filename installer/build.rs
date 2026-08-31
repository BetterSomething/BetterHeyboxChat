use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let root = manifest_dir
        .parent()
        .expect("installer 应在仓库根下")
        .to_path_buf();

    println!(
        "cargo:rerun-if-changed={}",
        root.join("scripts/resolve-version.mjs").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        root.join("scripts/lib/versioning.mjs").display()
    );
    println!("cargo:rerun-if-env-changed=BHC_VERSION");

    let _ = Command::new("node")
        .arg(root.join("scripts/resolve-version.mjs"))
        .current_dir(&root)
        .status();

    let (version, channel, commit) = read_version(&root).unwrap_or_else(|| {
        (
            "dev".to_string(),
            "dev".to_string(),
            "unknown".to_string(),
        )
    });

    println!("cargo:rustc-env=BHC_VERSION={version}");
    println!("cargo:rustc-env=BHC_CHANNEL={channel}");
    println!("cargo:rustc-env=BHC_COMMIT={commit}");
}

fn read_version(root: &Path) -> Option<(String, String, String)> {
    let text = fs::read_to_string(root.join("runtime/version.json")).ok()?;
    Some((
        json_string(&text, "version")?,
        json_string(&text, "channel").unwrap_or_else(|| "dev".into()),
        json_string(&text, "commit").unwrap_or_else(|| "unknown".into()),
    ))
}

fn json_string(json: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let start = json.find(&needle)?;
    let after = &json[start + needle.len()..];
    let colon = after.find(':')?;
    let rest = after[colon + 1..].trim_start();
    if !rest.starts_with('"') {
        return None;
    }
    let inner = &rest[1..];
    let end = inner.find('"')?;
    Some(inner[..end].to_string())
}
