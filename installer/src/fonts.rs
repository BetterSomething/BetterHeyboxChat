use eframe::egui::{self, FontData, FontDefinitions, FontFamily};
use std::sync::Arc;

/// CJK 作为 fallback，不要插到字体列表最前。
/// 微软雅黑覆盖了 ✓ / ⚠ 等符号但对应槽位是 .notdef，插到最前会导致「口」。
pub fn setup_fonts(ctx: &egui::Context) {
    let Some(cjk_data) = load_system_cjk_font() else {
        return;
    };

    let mut fonts = FontDefinitions::default();
    fonts
        .font_data
        .insert("cjk".to_owned(), Arc::new(cjk_data));

    for family in [FontFamily::Proportional, FontFamily::Monospace] {
        fonts.families.entry(family).or_default().push("cjk".to_owned());
    }

    ctx.set_fonts(fonts);
}

#[cfg(windows)]
fn load_system_cjk_font() -> Option<FontData> {
    const CANDIDATES: &[&str] = &[
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simsun.ttc",
    ];

    for path in CANDIDATES {
        if let Ok(bytes) = std::fs::read(path) {
            let mut data = FontData::from_owned(bytes);
            data.index = 0;
            return Some(data);
        }
    }
    None
}

#[cfg(not(windows))]
fn load_system_cjk_font() -> Option<FontData> {
    None
}
