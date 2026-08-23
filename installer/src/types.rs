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
    pub loader_version: String,
    pub installed_at: String,
    pub client_version: String,
    pub install_root: String,
    pub app_dir: String,
    pub backed_up_files: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PackageJson {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub dev_dependencies: std::collections::HashMap<String, String>,
}
