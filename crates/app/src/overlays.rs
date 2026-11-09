//! Overlays (Vibe Clip): each overlay's picture, made from its settings and
//! put up for the capture (`capture::overlay`), and the capture's list kept
//! the same as the settings' (what shows, where, in what order).
//!
//! An image is read from its file (on a thread of its own: a big one takes a
//! moment); text is drawn in the app's typeface; a web page is drawn by
//! `browser`, as it plays. Each is made again only when what it shows
//! changes. A new overlay is placed by its picture's shape once that's known.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use ab_glyph::{Font, FontRef, PxScale, ScaleFont, VariableFont, point};
use capture::overlay::{Overlay, SharedPicture};

use crate::settings::{OverlayCfg, OverlayKind};

/// The overlays' pictures, by key, and how each is going.
#[derive(Default)]
pub(crate) struct Overlays {
    made: HashMap<u32, Made>,
    /// The video's shape (width over height), as the Sources page last saw it.
    pub(crate) frame_aspect: Option<f32>,
}

/// One overlay's picture.
struct Made {
    picture: SharedPicture,
    /// What it was made from (its kind, as JSON): made again when that changes.
    from: String,
    /// Its picture's size, once made; or why it couldn't be.
    state: Arc<Mutex<State>>,
    /// A web page's renderer, while it's on.
    browser: Option<crate::browser::Page>,
    /// The picture's size its box was last fitted to.
    fitted: Option<(u32, u32)>,
}

#[derive(Default, Clone)]
pub(crate) enum State {
    #[default]
    Making,
    Made(u32, u32),
    Failed(String),
}

impl Overlays {
    /// Bring the pictures and the capture's list in line with `cfgs`, placing
    /// any that has no box yet. `ctx` is woken when a picture is ready.
    pub(crate) fn sync(&mut self, cfgs: &mut [OverlayCfg], ctx: &egui::Context) {
        let aspect = self.frame_aspect.unwrap_or(16.0 / 9.0);
        self.made.retain(|key, _| cfgs.iter().any(|c| c.key == *key));
        let mut list = Vec::new();
        for cfg in cfgs.iter_mut() {
            let from = serde_json::to_string(&cfg.kind).unwrap_or_default();
            let made = self.made.entry(cfg.key).or_insert_with(|| Made { picture: Default::default(), from: String::new(), state: Default::default(), browser: None, fitted: None });
            // A browser overlay runs only while it's shown.
            let wants_page = cfg.visible && matches!(cfg.kind, OverlayKind::Browser { .. });
            if made.from != from || (wants_page && made.browser.is_none()) || (!wants_page && made.browser.is_some()) {
                made.from = from;
                made.browser = None;
                *made.state.lock().unwrap() = State::Making;
                make(&cfg.kind, cfg.visible, made, ctx);
            }
            if let Some(page) = &made.browser {
                page.set_size_from(&cfg.kind);
            }
            if let State::Made(w, h) = *made.state.lock().unwrap() {
                match cfg.rect {
                    None => cfg.rect = Some(first_rect(&cfg.kind, (w, h), aspect)),
                    // Another shape than it was fitted to (text typed, another
                    // image): its height and middle kept, its width follows.
                    Some([x, y, rw, rh]) if made.fitted.is_some_and(|f| f != (w, h)) => {
                        let nw = rh * (w as f32 / h.max(1) as f32) / aspect;
                        cfg.rect = Some([x + (rw - nw) / 2.0, y, nw, rh]);
                    }
                    _ => {}
                }
                made.fitted = Some((w, h));
            }
            if let (true, Some(rect)) = (cfg.visible, cfg.rect) {
                list.push(Overlay { id: cfg.key.to_string(), rect, picture: made.picture.clone() });
            }
        }
        if let Ok(mut shared) = capture::overlay::shared().lock() {
            *shared = list;
        }
        // Their sound source follows their browser process.
        capture::sources::set_browser_pid(self.browser_pid().unwrap_or(0));
    }

    /// How an overlay's picture is going.
    pub(crate) fn state(&self, key: u32) -> State {
        self.made.get(&key).map(|m| m.state.lock().unwrap().clone()).unwrap_or_default()
    }

    /// The browser process of the browser overlays (they share one), whose
    /// sound is theirs, once one is open.
    pub(crate) fn browser_pid(&self) -> Option<u32> {
        self.made.values().filter_map(|m| m.browser.as_ref()).find_map(|p| p.sound_pid())
    }

    /// The size of an overlay's picture, once it's made.
    pub(crate) fn picture_size(&self, key: u32) -> Option<(u32, u32)> {
        match self.state(key) {
            State::Made(w, h) => Some((w, h)),
            _ => None,
        }
    }
}

/// Start making an overlay's picture.
fn make(kind: &OverlayKind, visible: bool, made: &mut Made, ctx: &egui::Context) {
    let (picture, state) = (made.picture.clone(), made.state.clone());
    match kind.clone() {
        OverlayKind::Image { path } => {
            let ctx = ctx.clone();
            std::thread::spawn(move || {
                let result = image::open(&path).map(|i| i.to_rgba8());
                *state.lock().unwrap() = match result {
                    Ok(img) => {
                        let (w, h) = img.dimensions();
                        capture::overlay::put(&picture, w, h, img.into_raw());
                        State::Made(w, h)
                    }
                    Err(e) => {
                        *picture.lock().unwrap() = None;
                        State::Failed(format!("Couldn't open the image: {e}"))
                    }
                };
                ctx.request_repaint();
            });
        }
        OverlayKind::Text { text, size, color, outline } => {
            let (w, h, rgba) = draw_text(&text, size, color, outline);
            capture::overlay::put(&picture, w, h, rgba);
            *state.lock().unwrap() = State::Made(w, h);
        }
        OverlayKind::Browser { url, width, height, sound } => {
            *picture.lock().unwrap() = None;
            if visible {
                match crate::browser::Page::open(&url, width, height, picture.clone(), state.clone(), ctx.clone()) {
                    Ok(page) => {
                        // Its sound left out: silent in the browser itself.
                        page.set_muted(!sound);
                        made.browser = Some(page);
                    }
                    Err(e) => *state.lock().unwrap() = State::Failed(e),
                }
            } else {
                *state.lock().unwrap() = State::Made(width, height);
            }
        }
    }
}

/// Where a new overlay goes, by its picture's size: text and pages at their
/// size in a 1080p video, an image too but no more than half the video
/// wide; in the middle.
pub(crate) fn first_rect(kind: &OverlayKind, (w, h): (u32, u32), aspect: f32) -> [f32; 4] {
    let (mut fw, mut fh) = (w as f32 / (1080.0 * aspect), h as f32 / 1080.0);
    let most = if matches!(kind, OverlayKind::Image { .. }) { 0.5 } else { 1.0 };
    if fw > most {
        fh *= most / fw;
        fw = most;
    }
    if fh > 1.0 {
        fw /= fh;
        fh = 1.0;
    }
    [(1.0 - fw) / 2.0, (1.0 - fh) / 2.0, fw, fh]
}

/// Text in the app's typeface (bold), `size` pixels a line, each line
/// centred, in `color`, with a dark outline (`outline`): straight RGBA.
pub(crate) fn draw_text(text: &str, size: f32, color: [u8; 4], outline: bool) -> (u32, u32, Vec<u8>) {
    static HANKEN: &[u8] = include_bytes!("../assets/fonts/HankenGrotesk.ttf");
    let mut font = FontRef::try_from_slice(HANKEN).expect("bundled font is valid");
    font.set_variation(b"wght", 700.0);
    let size = size.clamp(8.0, 400.0);
    let scaled = font.as_scaled(PxScale::from(size));
    let lines: Vec<&str> = if text.is_empty() { vec![" "] } else { text.lines().collect() };
    let line_h = (scaled.ascent() - scaled.descent() + scaled.line_gap()).ceil();
    // Room round the letters for the outline.
    let pad = if outline { (size / 12.0).ceil().max(2.0) } else { 1.0 };
    let width_of = |line: &str| {
        let mut x = 0.0;
        let mut prev = None;
        for c in line.chars() {
            let id = font.glyph_id(c);
            if let Some(p) = prev {
                x += scaled.kern(p, id);
            }
            x += scaled.h_advance(id);
            prev = Some(id);
        }
        x
    };
    let widest = lines.iter().map(|l| width_of(l)).fold(1.0f32, f32::max);
    let (w, h) = ((widest + 2.0 * pad).ceil() as u32, (line_h * lines.len() as f32 + 2.0 * pad).ceil() as u32);
    // Coverage of the letters, then of the outline (the letters grown by `pad`).
    let mut ink = vec![0f32; (w * h) as usize];
    for (n, line) in lines.iter().enumerate() {
        let mut x = pad + (widest - width_of(line)) / 2.0;
        let top = pad + n as f32 * line_h + scaled.ascent();
        let mut prev = None;
        for c in line.chars() {
            let id = font.glyph_id(c);
            if let Some(p) = prev {
                x += scaled.kern(p, id);
            }
            if let Some(o) = font.outline_glyph(id.with_scale_and_position(size, point(x, top))) {
                let b = o.px_bounds();
                o.draw(|gx, gy, cov| {
                    let (px, py) = (b.min.x as i64 + gx as i64, b.min.y as i64 + gy as i64);
                    if px >= 0 && py >= 0 && (px as u32) < w && (py as u32) < h {
                        let i = (py as u32 * w + px as u32) as usize;
                        ink[i] = (ink[i] + cov).min(1.0);
                    }
                });
            }
            x += scaled.h_advance(id);
            prev = Some(id);
        }
    }
    let edge = if outline { grow(&ink, w, h, pad as i64) } else { vec![0.0; ink.len()] };
    let mut rgba = Vec::with_capacity(ink.len() * 4);
    for (a, e) in ink.iter().zip(&edge) {
        // The letter over its outline (dark, a little see-through).
        let (la, ea) = (*a * color[3] as f32 / 255.0, *e * 0.85);
        let out_a = la + ea * (1.0 - la);
        if out_a <= 0.0 {
            rgba.extend([0, 0, 0, 0]);
            continue;
        }
        let mixed = |c: u8| ((c as f32 * la + 12.0 * ea * (1.0 - la)) / out_a).round().clamp(0.0, 255.0) as u8;
        rgba.extend([mixed(color[0]), mixed(color[1]), mixed(color[2]), (out_a * 255.0).round() as u8]);
    }
    (w, h, rgba)
}

/// `ink` grown by `r` pixels all round (the most within a circle of `r`).
fn grow(ink: &[f32], w: u32, h: u32, r: i64) -> Vec<f32> {
    let (w, h) = (w as i64, h as i64);
    let offsets: Vec<(i64, i64)> = (-r..=r).flat_map(|dy| (-r..=r).map(move |dx| (dx, dy))).filter(|(dx, dy)| dx * dx + dy * dy <= r * r).collect();
    let mut out = vec![0f32; ink.len()];
    for y in 0..h {
        for x in 0..w {
            let mut most = 0f32;
            for (dx, dy) in &offsets {
                let (sx, sy) = (x + dx, y + dy);
                if sx >= 0 && sy >= 0 && sx < w && sy < h {
                    most = most.max(ink[(sy * w + sx) as usize]);
                    if most >= 1.0 {
                        break;
                    }
                }
            }
            out[(y * w + x) as usize] = most;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_drawn_with_its_outline() {
        let (w, h, rgba) = draw_text("Vibe Clip\n123 bpm", 64.0, [255, 0, 0, 255], true);
        assert_eq!(rgba.len(), (w * h * 4) as usize);
        assert!(w > 200 && h > 120, "{w}×{h}: two lines at 64 px");
        let px = |i: usize| &rgba[i * 4..i * 4 + 4];
        assert!((0..(w * h) as usize).any(|i| px(i) == [255, 0, 0, 255]), "solid red letters");
        assert!((0..(w * h) as usize).any(|i| px(i)[3] > 150 && px(i)[0] < 40), "a dark outline");
        assert_eq!(px(0)[3], 0, "transparent round it");
    }

    #[test]
    fn new_overlays_are_placed_by_their_shape() {
        let text = OverlayKind::Text { text: "x".into(), size: 64.0, color: [255; 4], outline: true };
        let [x, y, w, h] = first_rect(&text, (192, 108), 16.0 / 9.0);
        assert!((w - 0.1).abs() < 1e-4 && (h - 0.1).abs() < 1e-4, "its size in a 1080p video");
        assert!((x - 0.45).abs() < 1e-4 && (y - 0.45).abs() < 1e-4, "in the middle");
        let image = OverlayKind::Image { path: String::new() };
        let [_, _, w, h] = first_rect(&image, (3840, 2160), 16.0 / 9.0);
        assert!((w - 0.5).abs() < 1e-4 && (h - 0.5).abs() < 1e-4, "a big image half the video wide");
    }
}
