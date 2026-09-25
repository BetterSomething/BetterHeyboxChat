use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct ClientInstall {
    pub install_root: PathBuf,
    pub version: String,
    pub version_dir: PathBuf,
    pub app_dir: PathBuf,
    pub package_name: String,
    pub electron_version: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PatchState {
    pub installed: bool,
    pub preload_patched: bool,
    pub html_patched: bool,
    pub runtime_present: bool,
    pub loader_version: Option<String>,
    pub installed_at: Option<String>,
    pub client_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InstallManifest {
    #[serde(rename = "loaderVersion", alias = "loader_version")]
    pub loader_version: String,
    #[serde(rename = "installedAt", alias = "installed_at")]
    pub installed_at: String,
    #[serde(rename = "clientVersion", alias = "client_version")]
    pub client_version: String,
    #[serde(rename = "installRoot", alias = "install_root")]
    pub install_root: String,
    #[serde(rename = "appDir", alias = "app_dir")]
    pub app_dir: String,
    #[serde(rename = "backedUpFiles", alias = "backed_up_files")]
    pub backed_up_files: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PackageJson {
    pub name: String,
    pub version: String,
    #[serde(default, rename = "devDependencies", alias = "dev_dependencies")]
    pub dev_dependencies: std::collections::HashMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::{InstallManifest, PackageJson};

    #[test]
    fn install_manifest_reads_camel_and_snake() {
        let camel = r#"{
            "loaderVersion":"0.1.0",
            "installedAt":"t",
            "clientVersion":"1.56.0",
            "installRoot":"C:/hb",
            "appDir":"C:/hb/app",
            "backedUpFiles":["a"]
        }"#;
        let snake = r#"{
            "loader_version":"0.1.0",
            "installed_at":"t",
            "client_version":"1.56.0",
            "install_root":"C:/hb",
            "app_dir":"C:/hb/app",
            "backed_up_files":["a"]
        }"#;
        let from_camel: InstallManifest = serde_json::from_str(camel).unwrap();
        let from_snake: InstallManifest = serde_json::from_str(snake).unwrap();
        assert_eq!(from_camel.loader_version, "0.1.0");
        assert_eq!(from_snake.loader_version, from_camel.loader_version);
        let written = serde_json::to_string(&from_camel).unwrap();
        assert!(written.contains("loaderVersion"));
        assert!(!written.contains("loader_version"));
    }

    #[test]
    fn package_json_reads_dev_dependencies() {
        let raw = r#"{"name":"heybox-chat-electron","version":"1.56.0","devDependencies":{"electron":"33.2.0"}}"#;
        let pkg: PackageJson = serde_json::from_str(raw).unwrap();
        assert_eq!(pkg.dev_dependencies.get("electron").map(String::as_str), Some("33.2.0"));
    }
}
