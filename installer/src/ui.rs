use crate::app::InstallerApp;
use crate::constants::{format_installer_label, LOADER_CHANNEL, LOADER_VERSION};
use eframe::egui::{self, Color32, CornerRadius, Margin, RichText, Stroke, Vec2};

const BG: Color32 = Color32::from_rgb(9, 9, 11);
const SURFACE: Color32 = Color32::from_rgb(24, 24, 27);
const BORDER: Color32 = Color32::from_rgb(39, 39, 42);
const FG: Color32 = Color32::from_rgb(250, 250, 250);
const MUTED: Color32 = Color32::from_rgb(161, 161, 170);
const SUCCESS: Color32 = Color32::from_rgb(74, 222, 128);
const DESTRUCTIVE: Color32 = Color32::from_rgb(248, 113, 113);
const PRIMARY_FG: Color32 = Color32::from_rgb(9, 9, 11);

pub fn setup_theme(ctx: &egui::Context) {
    let mut style = (*ctx.style()).clone();
    style.visuals.dark_mode = true;
    style.visuals.window_fill = BG;
    style.visuals.panel_fill = BG;
    style.visuals.extreme_bg_color = Color32::from_rgb(15, 15, 17);
    style.visuals.faint_bg_color = SURFACE;
    style.visuals.widgets.noninteractive.bg_fill = BG;
    style.visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0, MUTED);
    style.visuals.widgets.noninteractive.corner_radius = CornerRadius::same(6);
    style.visuals.widgets.inactive.bg_fill = SURFACE;
    style.visuals.widgets.inactive.weak_bg_fill = SURFACE;
    style.visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, BORDER);
    style.visuals.widgets.inactive.fg_stroke = Stroke::new(1.0, FG);
    style.visuals.widgets.inactive.corner_radius = CornerRadius::same(6);
    style.visuals.widgets.hovered.bg_fill = Color32::from_rgb(39, 39, 42);
    style.visuals.widgets.hovered.weak_bg_fill = Color32::from_rgb(39, 39, 42);
    style.visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, Color32::from_rgb(82, 82, 91));
    style.visuals.widgets.hovered.fg_stroke = Stroke::new(1.0, FG);
    style.visuals.widgets.hovered.corner_radius = CornerRadius::same(6);
    style.visuals.widgets.active.bg_fill = Color32::from_rgb(39, 39, 42);
    style.visuals.widgets.active.bg_stroke = Stroke::new(1.0, Color32::from_rgb(161, 161, 170));
    style.visuals.widgets.active.fg_stroke = Stroke::new(1.0, FG);
    style.visuals.widgets.active.corner_radius = CornerRadius::same(6);
    style.visuals.widgets.open.bg_fill = SURFACE;
    style.visuals.widgets.open.bg_stroke = Stroke::new(1.0, BORDER);
    style.visuals.selection.bg_fill = FG;
    style.visuals.selection.stroke = Stroke::new(1.0, PRIMARY_FG);
    style.spacing.item_spacing = Vec2::new(8.0, 8.0);
    style.spacing.button_padding = Vec2::new(12.0, 6.0);
    ctx.set_style(style);
}

pub fn render(app: &mut InstallerApp, ctx: &egui::Context) {
    egui::CentralPanel::default()
        .frame(
            egui::Frame::new()
                .fill(BG)
                .inner_margin(Margin::same(20)),
        )
        .show(ctx, |ui| {
            egui::ScrollArea::vertical()
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    ui.set_min_width(ui.available_width());
                    render_content(app, ui, ctx);
                });
        });
}

fn render_content(app: &mut InstallerApp, ui: &mut egui::Ui, ctx: &egui::Context) {
            ui.label(RichText::new("BetterHeyboxChat").size(20.0).color(FG).strong());
            ui.add_space(2.0);
            ui.label(
                RichText::new(format_installer_label(LOADER_VERSION, LOADER_CHANNEL))
                    .size(13.0)
                    .color(MUTED),
            );

            ui.add_space(10.0);
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new(format!("黑盒语音  {}", app.heybox_version_text))
                        .size(12.0)
                        .color(MUTED),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if app.admin {
                        pill(ui, "管理员", SUCCESS);
                    } else if small_outline(ui, "管理员重启", !app.busy) {
                        app.request_elevated_relaunch();
                    }
                });
            });

            ui.add_space(8.0);
            hairline(ui);
            ui.add_space(12.0);

            ui.horizontal(|ui| {
                let w = ((ui.available_width() - 16.0) / 3.0).max(96.0);
                if filled_btn(ui, "安装", app.can_install(), w) {
                    app.do_install(ctx);
                }
                if outline_btn(ui, "重装 / 更新", app.can_reinstall(), w) {
                    app.do_reinstall(ctx);
                }
                if destructive_btn(ui, "卸载", app.can_uninstall(), w) {
                    app.do_uninstall(ctx);
                }
            });
            ui.horizontal(|ui| {
                let w = ((ui.available_width() - 8.0) / 2.0).max(120.0);
                if ghost_btn(ui, "刷新检测", !app.busy, w) {
                    app.refresh_detection();
                }
                if ghost_btn(ui, "指定路径", !app.busy, w) {
                    app.show_manual_path = !app.show_manual_path;
                }
            });
            ui.horizontal(|ui| {
                let w = ((ui.available_width() - 8.0) / 2.0).max(120.0);
                if ghost_btn(ui, "修改数据地址", !app.busy, w) {
                    app.pick_data_root();
                }
                if ghost_btn(ui, "重置数据地址", !app.busy, w) {
                    app.reset_data_root();
                }
            });

            if app.show_manual_path {
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("路径").size(12.0).color(MUTED));
                    let input_width = (ui.available_width() - 148.0).max(120.0);
                    let response = ui.add(
                        egui::TextEdit::singleline(&mut app.manual_path_input)
                            .desired_width(input_width)
                            .hint_text("黑盒语音安装目录"),
                    );
                    if ghost_btn(ui, "浏览", !app.busy, 64.0) {
                        app.pick_manual_path();
                    }
                    if outline_btn(ui, "确定", !app.busy, 64.0) {
                        app.apply_manual_path();
                    }
                    if response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                        app.apply_manual_path();
                    }
                });
            }

            ui.add_space(14.0);
            ui.add(
                egui::ProgressBar::new(app.progress)
                    .desired_height(4.0)
                    .desired_width(ui.available_width())
                    .animate(app.busy),
            );
            ui.add_space(8.0);
            let status = if app.status_text.is_empty() {
                "等待操作"
            } else {
                app.status_text.as_str()
            };
            ui.label(RichText::new(status).size(13.0).color(FG));

            ui.add_space(14.0);
            hairline(ui);
            ui.add_space(10.0);
            kv(ui, "数据目录", &app.data_root_text);

            if let Some(install) = &app.install {
                kv(ui, "安装目录", &install.install_root.display().to_string());
                kv(ui, "App 目录", &install.app_dir.display().to_string());
                kv(
                    ui,
                    "补丁",
                    if app.patch_state.installed {
                        "已安装"
                    } else {
                        "未安装"
                    },
                );
                if let Some(version) = &app.patch_state.loader_version {
                    kv(ui, "Loader", version);
                }
                if let Some(at) = &app.patch_state.installed_at {
                    kv(ui, "安装时间", at);
                }
            }
}

fn kv(ui: &mut egui::Ui, key: &str, value: &str) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(key).size(12.0).color(MUTED));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.add(egui::Label::new(RichText::new(value).size(12.0).color(FG)).truncate());
        });
    });
}

fn hairline(ui: &mut egui::Ui) {
    let rect = egui::Rect::from_min_size(ui.cursor().min, Vec2::new(ui.available_width(), 1.0));
    ui.painter().rect_filled(rect, 0.0, BORDER);
    ui.add_space(1.0);
}

fn pill(ui: &mut egui::Ui, text: &str, fg: Color32) {
    let bg = Color32::from_rgba_unmultiplied(fg.r(), fg.g(), fg.b(), 24);
    egui::Frame::new()
        .fill(bg)
        .corner_radius(CornerRadius::same(4))
        .inner_margin(Margin::symmetric(8, 3))
        .show(ui, |ui| {
            ui.label(RichText::new(text).size(11.0).color(fg).strong());
        });
}

fn filled_btn(ui: &mut egui::Ui, label: &str, enabled: bool, width: f32) -> bool {
    let btn = egui::Button::new(RichText::new(label).color(PRIMARY_FG).strong())
        .fill(FG)
        .stroke(Stroke::NONE)
        .min_size(Vec2::new(width, 34.0));
    ui.add_enabled(enabled, btn).clicked()
}

fn outline_btn(ui: &mut egui::Ui, label: &str, enabled: bool, width: f32) -> bool {
    let btn = egui::Button::new(RichText::new(label).color(FG))
        .fill(SURFACE)
        .stroke(Stroke::new(1.0, BORDER))
        .min_size(Vec2::new(width, 34.0));
    ui.add_enabled(enabled, btn).clicked()
}

fn small_outline(ui: &mut egui::Ui, label: &str, enabled: bool) -> bool {
    let btn = egui::Button::new(RichText::new(label).size(12.0).color(FG))
        .fill(SURFACE)
        .stroke(Stroke::new(1.0, BORDER));
    ui.add_enabled(enabled, btn).clicked()
}

fn ghost_btn(ui: &mut egui::Ui, label: &str, enabled: bool, width: f32) -> bool {
    let btn = egui::Button::new(RichText::new(label).color(MUTED))
        .fill(Color32::TRANSPARENT)
        .stroke(Stroke::new(1.0, BORDER))
        .min_size(Vec2::new(width, 30.0));
    ui.add_enabled(enabled, btn).clicked()
}

fn destructive_btn(ui: &mut egui::Ui, label: &str, enabled: bool, width: f32) -> bool {
    let btn = egui::Button::new(RichText::new(label).color(DESTRUCTIVE))
        .fill(SURFACE)
        .stroke(Stroke::new(1.0, Color32::from_rgb(127, 29, 29)))
        .min_size(Vec2::new(width, 34.0));
    ui.add_enabled(enabled, btn).clicked()
}
