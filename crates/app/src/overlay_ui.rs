//! Overlays on the Sources page (Vibe Clip): adding them, their cards under
//! the preview (what each shows, and where), and their menus. They're placed
//! on the preview like the screen and the webcam (see `canvas_ui`).

use egui::{Pos2, Rect, vec2};

use crate::App;
use crate::canvas_ui::Layer;
use crate::settings::{OverlayCfg, OverlayKind};
use crate::theme::{self, W};
use crate::ui_kit::{self, Btn, Item, Kind};

impl App {
    fn overlay(&self, key: u32) -> Option<&OverlayCfg> {
        self.settings.overlays.iter().find(|o| o.key == key)
    }

    fn overlay_mut(&mut self, key: u32) -> Option<&mut OverlayCfg> {
        self.settings.overlays.iter_mut().find(|o| o.key == key)
    }

    /// An overlay's box (fractions of the video), once it has one.
    pub(crate) fn overlay_rect(&self, key: u32) -> Option<Rect> {
        self.overlay(key)?.rect.map(|[x, y, w, h]| Rect::from_min_size(Pos2::new(x, y), vec2(w, h)))
    }

    pub(crate) fn set_overlay_rect(&mut self, key: u32, r: Rect) {
        if let Some(o) = self.overlay_mut(key) {
            o.rect = Some([r.min.x, r.min.y, r.width(), r.height()]);
        }
    }

    /// What an overlay's card says: its icon, its name, and its line.
    pub(crate) fn overlay_card_line(&self, key: u32) -> (&'static str, String, String, bool) {
        use egui_phosphor::regular as icon;
        let Some(o) = self.overlay(key) else { return (icon::QUESTION, String::new(), String::new(), false) };
        let (glyph, line) = match &o.kind {
            OverlayKind::Image { path } => (icon::IMAGE, std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
            OverlayKind::Text { text, .. } => (icon::TEXT_T, text.lines().next().unwrap_or_default().to_owned()),
            OverlayKind::Browser { url, .. } => (icon::GLOBE, url.clone()),
        };
        let line = match self.overlays.state(key) {
            crate::overlays::State::Failed(e) => e,
            _ => line,
        };
        (glyph, o.name.clone(), line, o.visible)
    }

    /// Whether an overlay's picture couldn't be made (its card says why).
    pub(crate) fn overlay_failed(&self, key: u32) -> bool {
        matches!(self.overlays.state(key), crate::overlays::State::Failed(_))
    }

    /// Its switch: in the video or not.
    pub(crate) fn overlay_visible(&mut self, key: u32) -> Option<&mut bool> {
        self.overlay_mut(key).map(|o| &mut o.visible)
    }

    /// Add an overlay, in front of the others, its card open. An image asks
    /// for its file first (none chosen, none added).
    pub(crate) fn add_overlay(&mut self, kind: OverlayKind) {
        let kind = match kind {
            OverlayKind::Image { .. } => match pick_image() {
                Some(path) => OverlayKind::Image { path },
                None => return,
            },
            k => k,
        };
        let key = self.settings.overlays.iter().map(|o| o.key).max().unwrap_or(0) + 1;
        let name = kind.default_name();
        self.settings.overlays.push(OverlayCfg { key, name, kind, visible: true, rect: None });
        self.sources_view.open_cards.push(Layer::Overlay(key));
    }

    /// Its natural size again (as when it was added), where it is.
    pub(crate) fn overlay_reset_size(&mut self, key: u32, aspect: f32) {
        let (Some(size), Some(o)) = (self.overlays.picture_size(key), self.overlay(key)) else { return };
        let [_, _, w, h] = crate::overlays::first_rect(&o.kind, size, aspect);
        let c = self.overlay_rect(key).map_or(Pos2::new(0.5, 0.5), |r| r.center());
        self.set_overlay_rect(key, Rect::from_center_size(c, vec2(w, h)));
    }

    /// In the middle of the video, its size kept.
    pub(crate) fn overlay_centre(&mut self, key: u32) {
        if let Some(r) = self.overlay_rect(key) {
            self.set_overlay_rect(key, Rect::from_center_size(Pos2::new(0.5, 0.5), r.size()));
        }
    }

    /// Its menu: on the preview (right-click), and its card's.
    pub(crate) fn overlay_menu(&mut self, ui: &mut egui::Ui, key: u32, aspect: f32) {
        use egui_phosphor::regular as icon;
        if Item::new("Edit placement…").icon(icon::SLIDERS_HORIZONTAL).tip("Its position and size as numbers, on its card").show(ui).clicked() {
            self.open_placement(Layer::Overlay(key));
            ui.close();
        }
        crate::ui_kit::menu_sep(ui);
        if Item::new("Centre").icon(icon::ARROWS_OUT_CARDINAL).tip("In the middle of the video, its size kept").show(ui).clicked() {
            self.overlay_centre(key);
            ui.close();
        }
        let sized = self.overlays.picture_size(key).is_some();
        if Item::new("Reset size").icon(icon::RESIZE).enabled(sized).tip("Its own size again, unstretched, where it is").show(ui).clicked() {
            self.overlay_reset_size(key, aspect);
            ui.close();
        }
        crate::ui_kit::menu_sep(ui);
        let at = self.settings.overlays.iter().position(|o| o.key == key);
        let n = self.settings.overlays.len();
        if let Some(i) = at {
            if Item::new("Bring forward").icon(icon::SELECTION_FOREGROUND).enabled(i + 1 < n).tip("In front of the overlay in front of it").show(ui).clicked() {
                self.settings.overlays.swap(i, i + 1);
                ui.close();
            }
            if Item::new("Send backward").icon(icon::SELECTION_BACKGROUND).enabled(i > 0).tip("Behind the overlay behind it (overlays are always in front of the screen and webcam)").show(ui).clicked() {
                self.settings.overlays.swap(i, i - 1);
                ui.close();
            }
        }
        crate::ui_kit::menu_sep(ui);
        let visible = self.overlay(key).is_some_and(|o| o.visible);
        if Item::new(if visible { "Hide" } else { "Show" }).icon(if visible { icon::EYE_SLASH } else { icon::EYE }).show(ui).clicked() {
            if let Some(v) = self.overlay_visible(key) {
                *v = !*v;
            }
            ui.close();
        }
        if Item::new("Remove").icon(icon::TRASH).danger().tip("Take it out of your clips").show(ui).clicked() {
            self.settings.overlays.retain(|o| o.key != key);
            self.sources_view.open_cards.retain(|l| *l != Layer::Overlay(key));
            ui.close();
        }
    }

    /// Its settings, in its card: its name, where it is, and what it shows.
    pub(crate) fn overlay_rows(&mut self, ui: &mut egui::Ui, key: u32) {
        let pal = theme::pal(ui);
        let row = |ui: &mut egui::Ui, label: &str, add: &mut dyn FnMut(&mut egui::Ui)| {
            ui.horizontal(|ui| {
                ui.set_min_height(crate::sources_ui::GROUP_ROW_H);
                ui.spacing_mut().item_spacing.x = 6.0;
                ui.label(theme::text(label, 13.5, W::Regular).color(pal.text));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.spacing_mut().item_spacing.x = 6.0;
                    add(ui);
                });
            });
        };
        let Some(mut cfg) = self.overlay(key).cloned() else { return };
        row(ui, "Name", &mut |ui| {
            ui.allocate_ui(vec2(220.0, crate::ui_kit::CONTROL_H), |ui| ui_kit::text_field(ui, &mut cfg.name, "Name"));
        });
        ui_kit::divider(ui, 0.0);
        self.placement_row(ui, Layer::Overlay(key));
        ui_kit::divider(ui, 0.0);
        match &mut cfg.kind {
            OverlayKind::Image { path } => {
                let shown = std::path::Path::new(path.as_str()).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                row(ui, "Image", &mut |ui| {
                    if Btn::normal("Choose…").small().tip("Another image file: PNG, JPG, WebP or BMP").show(ui).clicked()
                        && let Some(p) = pick_image()
                    {
                        *path = p;
                    }
                    ui.label(theme::text(&shown, 12.5, W::Regular).color(pal.text3)).on_hover_text(path.as_str());
                });
            }
            OverlayKind::Text { text, size, color, outline } => {
                ui.add_space(6.0);
                ui.label(theme::text("Text", 13.5, W::Regular).color(pal.text));
                ui.add_space(4.0);
                egui::Frame::new().fill(pal.control).corner_radius(ui_kit::RADIUS).inner_margin(egui::Margin::symmetric(10, 7)).show(ui, |ui| {
                    ui.add(egui::TextEdit::multiline(text).frame(egui::Frame::NONE).font(theme::font(14.0, W::Regular)).desired_rows(2).desired_width(f32::INFINITY));
                });
                ui.add_space(4.0);
                row(ui, "Size", &mut |ui| {
                    ui.label(theme::text("px in 1080p", 12.5, W::Regular).color(pal.text3));
                    ui.add(egui::DragValue::new(size).range(8.0..=400.0).speed(0.5).max_decimals(0));
                });
                row(ui, "Colour", &mut |ui| {
                    let mut c = egui::Color32::from_rgba_unmultiplied(color[0], color[1], color[2], color[3]);
                    if egui::color_picker::color_edit_button_srgba(ui, &mut c, egui::color_picker::Alpha::OnlyBlend).changed() {
                        *color = c.to_srgba_unmultiplied();
                    }
                });
                row(ui, "Outline", &mut |ui| {
                    ui_kit::switch(ui, outline).on_hover_text("A dark edge round the letters, so they read on anything");
                });
            }
            OverlayKind::Browser { url, width, height, sound } => {
                row(ui, "Address", &mut |ui| {
                    ui.allocate_ui(vec2(260.0, crate::ui_kit::CONTROL_H), |ui| ui_kit::text_field(ui, url, "https://…"));
                });
                row(ui, "Page size", &mut |ui| {
                    ui.label(theme::text("px", 12.5, W::Regular).color(pal.text3));
                    ui.add(egui::DragValue::new(height).range(16..=4096).speed(1.0));
                    ui.label(theme::text("×", 12.5, W::Regular).color(pal.text3));
                    ui.add(egui::DragValue::new(width).range(16..=4096).speed(1.0));
                });
                row(ui, "Sound", &mut |ui| {
                    ui_kit::switch(ui, sound).on_hover_text("The page's sound in your clips (as a sound source of its own)");
                });
            }
        }
        // What's typed and chosen is the overlay's at once; its picture is
        // made again as it changes (see \`overlays\`).
        if let Some(o) = self.overlay_mut(key)
            && *o != cfg
        {
            *o = cfg;
        }
    }
}

/// Choose an image file.
fn pick_image() -> Option<String> {
    rfd::FileDialog::new().set_title("Choose an image").add_filter("Images", &["png", "jpg", "jpeg", "webp", "bmp"]).pick_file().map(|p| p.to_string_lossy().into_owned())
}

/// The add buttons, under the picture's cards: + Image, + Text, + Browser.
pub(crate) fn add_buttons(ui: &mut egui::Ui) -> Option<OverlayKind> {
    use egui_phosphor::regular as icon;
    let mut add = None;
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 6.0;
        if Btn::new(Kind::Normal, "Image").with_icon(icon::PLUS).small().tip("A picture over your clips: a logo, a frame, a sticker").show(ui).clicked() {
            add = Some(OverlayKind::Image { path: String::new() });
        }
        if Btn::new(Kind::Normal, "Text").with_icon(icon::PLUS).small().tip("Words over your clips").show(ui).clicked() {
            add = Some(OverlayKind::Text { text: "Your text".into(), size: 64.0, color: [255, 255, 255, 255], outline: true });
        }
        if Btn::new(Kind::Normal, "Browser").with_icon(icon::PLUS).small().tip("A web page over your clips, like OBS's browser source: a heart rate, chat, alerts").show(ui).clicked() {
            add = Some(OverlayKind::Browser { url: "https://".into(), width: 800, height: 600, sound: true });
        }
    });
    add
}
