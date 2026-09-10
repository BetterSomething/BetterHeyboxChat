mod constants;
mod client;
mod cli;
mod detect;
mod elevate;
mod fonts;
mod path_util;
mod patch;
mod types;
mod userdata;

mod app;
mod ui;

use app::InstallerApp;
use detect::detect_install;
use patch::reinstall_patches_managed;

fn viewport() -> egui::ViewportBuilder {
    egui::ViewportBuilder::default()
        .with_inner_size([520.0, 560.0])
        .with_min_inner_size([480.0, 360.0])
        .with_title("BetterHeyboxChat Installer")
}

fn native_options(renderer: eframe::Renderer) -> eframe::NativeOptions {
    eframe::NativeOptions {
        viewport: viewport(),
        renderer,
        hardware_acceleration: eframe::HardwareAcceleration::Preferred,
        ..Default::default()
    }
}

fn run(renderer: eframe::Renderer) -> eframe::Result<()> {
    eframe::run_native(
        "BetterHeyboxChat Installer",
        native_options(renderer),
        Box::new(|cc| Ok(Box::new(InstallerApp::new(cc)))),
    )
}

fn silent_reinstall(path: Option<std::path::PathBuf>) -> eframe::Result<()> {
    let install = detect_install(path.as_deref());
    let Some(install) = install else {
        eprintln!("未找到黑盒语音安装，请用 --path 指定安装根目录。");
        std::process::exit(2);
    };
    match reinstall_patches_managed(&install) {
        Ok(msg) => {
            println!("{msg}");
            Ok(())
        }
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    }
}

fn main() -> eframe::Result<()> {
    let args = cli::parse_args(std::env::args());
    if elevate::should_auto_elevate(elevate::is_admin(), elevate::already_attempted_elevate()) {
        if elevate::request_admin_relaunch() {
            return Ok(());
        }
    }

    if cli::wants_silent_reinstall(&args) {
        return silent_reinstall(args.path);
    }

    // Windows 上 glow/OpenGL 经常拿到 1.1 上下文（远程桌面、管理员会话、驱动异常），
    // egui_glow 会直接报 "requires opengl 2.0+"。优先走 wgpu（DX12/DX11）。
    match run(eframe::Renderer::Wgpu) {
        Ok(()) => Ok(()),
        Err(err) => {
            eprintln!("[BetterHeyboxChat] wgpu 启动失败，回退 OpenGL: {err}");
            run(eframe::Renderer::Glow)
        }
    }
}
