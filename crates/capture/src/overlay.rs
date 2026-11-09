//! Overlays (Vibe Clip): pictures drawn over the recording, like OBS's image,
//! text and browser sources. Each is a picture with transparency (straight
//! RGBA) and a box in the frame, as fractions of the frame's width and height.
//!
//! The list is shared ([`SharedOverlays`]) between the app, which adds, moves
//! and removes overlays, and the capture, which reads it for every frame: a
//! change shows at once, even while recording. Each overlay's picture is
//! shared the same way, so whatever makes it (an image file read once, text
//! drawn when it changes, a web page as it plays) puts up a new one whenever
//! it likes, and the next frame draws it.

use std::sync::{Arc, Mutex};

/// One picture of an overlay: straight (not premultiplied) RGBA, row after row.
pub struct OverlayPicture {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    /// Different for every picture put up: what's drawn is uploaded to the
    /// graphics card again only when it changes.
    pub version: u64,
}

/// The newest picture of an overlay, put up by whatever makes it.
pub type SharedPicture = Arc<Mutex<Option<Arc<OverlayPicture>>>>;

/// An overlay as the capture draws it.
#[derive(Clone)]
pub struct Overlay {
    /// Stable id (the app's), naming its picture on the graphics card.
    pub id: String,
    /// Its box in the frame: left, top, width, height, as fractions of the
    /// frame's width and height. May reach past the frame's edges.
    pub rect: [f32; 4],
    pub picture: SharedPicture,
}

/// The overlays, bottom first (each drawn over the ones before it).
pub type SharedOverlays = Arc<Mutex<Vec<Overlay>>>;

/// The app's overlays: one list, read by every capture and preview.
pub fn shared() -> SharedOverlays {
    static LIST: std::sync::OnceLock<SharedOverlays> = std::sync::OnceLock::new();
    LIST.get_or_init(Default::default).clone()
}

/// A picture's next version number.
pub fn next_version() -> u64 {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Put up `rgba` (straight alpha, `width`×`height`) as `picture`'s newest.
pub fn put(picture: &SharedPicture, width: u32, height: u32, rgba: Vec<u8>) {
    if width == 0 || height == 0 || rgba.len() < (width * height * 4) as usize {
        return;
    }
    let p = Arc::new(OverlayPicture { width, height, rgba, version: next_version() });
    if let Ok(mut now) = picture.lock() {
        *now = Some(p);
    }
}

/// Where an overlay's box is in a frame of `width`×`height`, in pixels (left,
/// top, right, bottom), or None if none of it is in the frame or it's too
/// small to see.
pub fn dest_px(rect: [f32; 4], width: u32, height: u32) -> Option<[f32; 4]> {
    let [x, y, w, h] = rect;
    let (fw, fh) = (width as f32, height as f32);
    let d = [x * fw, y * fh, (x + w) * fw, (y + h) * fh];
    let visible = d[2] > 0.0 && d[3] > 0.0 && d[0] < fw && d[1] < fh && d[2] - d[0] >= 1.0 && d[3] - d[1] >= 1.0;
    visible.then_some(d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boxes_in_pixels() {
        assert_eq!(dest_px([0.5, 0.25, 0.25, 0.5], 1920, 1080), Some([960.0, 270.0, 1440.0, 810.0]));
        assert_eq!(dest_px([1.2, 0.0, 0.2, 0.2], 1920, 1080), None, "all of it off the frame");
        assert_eq!(dest_px([0.0, 0.0, 0.0001, 0.5], 1920, 1080), None, "too thin to see");
    }

    #[test]
    fn pictures_get_new_versions() {
        let pic: SharedPicture = Default::default();
        put(&pic, 2, 1, vec![255; 8]);
        let a = pic.lock().unwrap().as_ref().unwrap().version;
        put(&pic, 2, 1, vec![0; 8]);
        let b = pic.lock().unwrap().as_ref().unwrap().version;
        assert!(b > a);
        put(&pic, 2, 2, vec![0; 8]);
        assert_eq!(pic.lock().unwrap().as_ref().unwrap().height, 1, "a picture short of its size isn't put up");
    }
}
