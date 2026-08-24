mod constants;
mod client;
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

fn main() -> eframe::Result<()> {
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
