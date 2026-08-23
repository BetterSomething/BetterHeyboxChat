mod constants;
mod client;
mod detect;
mod elevate;
mod fonts;
mod path_util;
mod patch;
mod types;

mod app;
mod ui;

use app::InstallerApp;

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([520.0, 460.0])
            .with_min_inner_size([480.0, 400.0])
            .with_title("BetterHeyboxChat Installer"),
        ..Default::default()
    };

    eframe::run_native(
        "BetterHeyboxChat Installer",
        options,
        Box::new(|cc| Ok(Box::new(InstallerApp::new(cc)))),
    )
}
