use crate::path_util::normalize_path;
use crate::types::ClientInstall;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

const PROCESS_NAME: &str = "HeyboxChat.exe";
const EXIT_TIMEOUT: Duration = Duration::from_secs(15);
const EXIT_POLL: Duration = Duration::from_millis(200);

pub fn is_heybox_running() -> bool {
    platform::is_process_running(PROCESS_NAME)
}

pub fn stop_heybox() -> Result<(), String> {
    if !is_heybox_running() {
        return Ok(());
    }
    platform::kill_process(PROCESS_NAME)
}

pub fn wait_for_exit(timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    while is_heybox_running() {
        if start.elapsed() >= timeout {
            return Err("等待黑盒语音退出超时，请手动关闭后重试。".into());
        }
        thread::sleep(EXIT_POLL);
    }
    Ok(())
}

pub fn launch_heybox(install: &ClientInstall) -> Result<(), String> {
    let exe = find_client_exe(install)?;
    let work_dir = exe
        .parent()
        .ok_or_else(|| "无法确定黑盒语音工作目录。".to_string())?;

    platform::spawn_detached(&exe, work_dir)
}

pub fn find_client_exe(install: &ClientInstall) -> Result<PathBuf, String> {
    let candidates = [
        normalize_path(&install.version_dir).join("HeyboxChat.exe"),
        normalize_path(&install.install_root).join("HeyboxChat.exe"),
    ];

    for exe in candidates {
        if exe.is_file() {
            return Ok(exe);
        }
    }

    Err("找不到 HeyboxChat.exe，请确认黑盒语音安装完整。".into())
}

pub fn restart_heybox_if_was_running(
    install: &ClientInstall,
    was_running: bool,
) -> Result<(), String> {
    if was_running {
        launch_heybox(install)
    } else {
        Ok(())
    }
}

pub fn stop_if_running() -> Result<bool, String> {
    let was_running = is_heybox_running();
    if was_running {
        stop_heybox()?;
        wait_for_exit(EXIT_TIMEOUT)?;
    }
    Ok(was_running)
}

#[cfg(windows)]
mod platform {
    use std::path::Path;
    use std::process::Command;

    pub fn is_process_running(image_name: &str) -> bool {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("IMAGENAME eq {image_name}"), "/NH"])
            .output();

        match output {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout)
                    .to_ascii_lowercase()
                    .contains(&image_name.to_ascii_lowercase())
            }
            _ => false,
        }
    }

    pub fn kill_process(image_name: &str) -> Result<(), String> {
        let status = Command::new("taskkill")
            .args(["/F", "/IM", image_name, "/T"])
            .status()
            .map_err(|e| format!("关闭黑盒语音失败: {e}"))?;

        if status.success() || !is_process_running(image_name) {
            Ok(())
        } else {
            Err("无法关闭黑盒语音，请手动退出后重试。".into())
        }
    }

    pub fn spawn_detached(exe: &Path, work_dir: &Path) -> Result<(), String> {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        // `start` 会创建与当前控制台/job 无关的独立进程，避免关闭安装器控制台时连带退出黑盒语音。
        let status = Command::new("cmd")
            .args(["/C", "start", "", "/D", &work_dir.to_string_lossy(), &exe.to_string_lossy()])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("启动黑盒语音失败: {e}"))?;

        if status.success() {
            Ok(())
        } else {
            Err("启动黑盒语音失败。".into())
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::path::Path;

    pub fn is_process_running(_image_name: &str) -> bool {
        false
    }

    pub fn kill_process(_image_name: &str) -> Result<(), String> {
        Ok(())
    }

    pub fn spawn_detached(_exe: &Path, _work_dir: &Path) -> Result<(), String> {
        Err("当前平台暂不支持自动重启黑盒语音。".into())
    }
}
