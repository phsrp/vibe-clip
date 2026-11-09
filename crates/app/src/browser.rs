//! Browser overlays (Vibe Clip): a web page drawn off the screen by WebView2,
//! its pictures put up for the capture as it plays.

use std::sync::{Arc, Mutex};

use capture::overlay::SharedPicture;

use crate::overlays::State;
use crate::settings::OverlayKind;

/// A web page being drawn for an overlay, until it's dropped.
pub(crate) struct Page;

impl Page {
    /// Start drawing `url` at `width`×`height` into `picture`.
    pub(crate) fn open(_url: &str, _width: u32, _height: u32, _picture: SharedPicture, _state: Arc<Mutex<State>>, _ctx: egui::Context) -> Result<Self, String> {
        Err("Browser overlays aren't ready yet".into())
    }

    /// Follow a change of the page's size.
    pub(crate) fn set_size_from(&self, _kind: &OverlayKind) {}
}
