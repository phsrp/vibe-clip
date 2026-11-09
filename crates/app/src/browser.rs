//! Browser overlays (Vibe Clip): a web page drawn off the screen by WebView2
//! (the Edge engine, part of Windows), its pictures put up for the capture as
//! it plays, like OBS's browser source.
//!
//! Each page has a thread of its own: a hidden window (far off the screens,
//! never in the taskbar or given the focus) that WebView2 draws into, with a
//! transparent background, one page pixel to one pixel. Its pictures come
//! from Chromium's own screencast (DevTools' `Page.startScreencast`): a new
//! one each time the page changes, nothing while it's still. Chromium is told
//! not to slow down a page nobody can see, which it would take this for.
//!
//! Its sound is the browser's process's (see `sound_pid`), captured on its own.

use std::sync::{Arc, Mutex};

use capture::overlay::SharedPicture;

use crate::overlays::State;
use crate::settings::OverlayKind;

/// A web page being drawn for an overlay, until it's dropped.
pub(crate) struct Page {
    #[cfg(windows)]
    inner: imp::Page,
}

impl Page {
    /// Start drawing `url` at `width`×`height` into `picture`; `state` says
    /// how it's going, and `ctx` is woken for each new picture.
    pub(crate) fn open(url: &str, width: u32, height: u32, picture: SharedPicture, state: Arc<Mutex<State>>, ctx: egui::Context) -> Result<Self, String> {
        #[cfg(windows)]
        {
            Ok(Self { inner: imp::Page::open(url, width, height, picture, state, ctx)? })
        }
        #[cfg(not(windows))]
        {
            let _ = (url, width, height, picture, state, ctx);
            Err("Browser overlays need Windows".into())
        }
    }

    /// Follow a change of the page's size.
    pub(crate) fn set_size_from(&self, kind: &OverlayKind) {
        #[cfg(windows)]
        if let OverlayKind::Browser { width, height, .. } = kind {
            self.inner.resize(*width, *height);
        }
        #[cfg(not(windows))]
        let _ = kind;
    }

    /// The browser's process, whose sound is the page's (once it's known).
    pub(crate) fn sound_pid(&self) -> Option<u32> {
        #[cfg(windows)]
        {
            self.inner.pid()
        }
        #[cfg(not(windows))]
        None
    }

    /// Silence the page (its sound is left out), or let it be heard.
    pub(crate) fn set_muted(&self, muted: bool) {
        #[cfg(windows)]
        self.inner.set_muted(muted);
        #[cfg(not(windows))]
        let _ = muted;
    }
}

/// Standard base64 (DevTools sends the pictures in it), padding optional.
fn base64(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let bytes: Vec<u8> = text.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let v: Vec<u8> = chunk.iter().map(|c| value(*c)).collect::<Option<_>>()?;
        let n = v.iter().enumerate().fold(0u32, |n, (i, x)| n | (u32::from(*x) << (18 - 6 * i)));
        let take = match v.len() {
            4 => 3,
            3 => 2,
            2 => 1,
            _ => return None,
        };
        out.extend_from_slice(&n.to_be_bytes()[1..1 + take]);
    }
    Some(out)
}

/// Chromium's screencast of a see-through page has its colours already
/// multiplied by their opacity (a half-see-through green is half as bright):
/// the overlays' pictures are straight, so they're divided back out.
fn unpremultiply(mut rgba: Vec<u8>) -> Vec<u8> {
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a > 0 && a < 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    rgba
}

/// A screencast picture (a PNG, as DevTools sends it) put up as `picture`.
fn put_png(json: &str, picture: &SharedPicture) -> Option<(u32, u32, String)> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let session = v.get("sessionId")?.to_string();
    let png = base64(v.get("data")?.as_str()?)?;
    let img = image::load_from_memory_with_format(&png, image::ImageFormat::Png).ok()?.to_rgba8();
    let (w, h) = img.dimensions();
    capture::overlay::put(picture, w, h, unpremultiply(img.into_raw()));
    Some((w, h, session))
}

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex, mpsc};

    use capture::overlay::SharedPicture;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{CoreWebView2EnvironmentOptions, CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler, DevToolsProtocolEventReceivedEventHandler, NavigationCompletedEventHandler};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows::core::{HSTRING, PCWSTR, PWSTR, w};

    use crate::overlays::State;

    enum Cmd {
        Resize(u32, u32),
        Mute(bool),
        Close,
    }

    pub(super) struct Page {
        tx: mpsc::Sender<Cmd>,
        thread: u32,
        size: Mutex<(u32, u32)>,
        pid: Arc<AtomicU32>,
    }

    impl Page {
        pub(super) fn open(url: &str, width: u32, height: u32, picture: SharedPicture, state: Arc<Mutex<State>>, ctx: egui::Context) -> Result<Self, String> {
            let (tx, rx) = mpsc::channel();
            let (started_tx, started_rx) = mpsc::channel();
            let pid = Arc::new(AtomicU32::new(0));
            let (url, pid2) = (url.to_owned(), pid.clone());
            std::thread::Builder::new()
                .name("browser overlay".into())
                .spawn(move || {
                    let thread = unsafe { GetCurrentThreadId() };
                    let _ = started_tx.send(thread);
                    if let Err(e) = run(&url, width, height, picture, state.clone(), ctx.clone(), rx, pid2) {
                        eprintln!("browser overlay {url}: {e}");
                        *state.lock().unwrap() = State::Failed(format!("The page couldn't be shown: {e}"));
                        ctx.request_repaint();
                    }
                })
                .map_err(|e| e.to_string())?;
            let thread = started_rx.recv().map_err(|e| e.to_string())?;
            Ok(Self { tx, thread, size: Mutex::new((width, height)), pid })
        }

        fn send(&self, cmd: Cmd) {
            let _ = self.tx.send(cmd);
            // Wake its message loop to take it.
            unsafe {
                let _ = PostThreadMessageW(self.thread, WM_APP, WPARAM(0), LPARAM(0));
            }
        }

        pub(super) fn resize(&self, width: u32, height: u32) {
            let mut size = self.size.lock().unwrap();
            if *size != (width, height) {
                *size = (width, height);
                self.send(Cmd::Resize(width, height));
            }
        }

        pub(super) fn set_muted(&self, muted: bool) {
            self.send(Cmd::Mute(muted));
        }

        pub(super) fn pid(&self) -> Option<u32> {
            Some(self.pid.load(Ordering::Relaxed)).filter(|p| *p != 0)
        }
    }

    impl Drop for Page {
        fn drop(&mut self) {
            self.send(Cmd::Close);
        }
    }

    unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        unsafe { DefWindowProcW(hwnd, msg, w, l) }
    }

    /// The hidden window WebView2 draws into: far off every screen, never in
    /// the taskbar, never taking the focus.
    fn host_window(width: u32, height: u32) -> windows::core::Result<HWND> {
        unsafe {
            let instance = GetModuleHandleW(None)?;
            let class = w!("VibeClipBrowserOverlay");
            let wc = WNDCLASSW { lpfnWndProc: Some(window_proc), hInstance: instance.into(), lpszClassName: class, ..Default::default() };
            RegisterClassW(&wc); // already registered by another page: fine
            let hwnd = CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                class,
                w!("Vibe Clip browser overlay"),
                WS_POPUP,
                -32000,
                -32000,
                width as i32,
                height as i32,
                None,
                None,
                Some(instance.into()),
                None,
            )?;
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            Ok(hwnd)
        }
    }

    fn call(webview: &ICoreWebView2, method: &str, params: &str) {
        unsafe {
            let _ = webview.CallDevToolsProtocolMethod(&HSTRING::from(method), &HSTRING::from(params), None);
        }
    }

    /// The page's thread: open it, put up its pictures, and follow what
    /// it's told until it's closed.
    #[allow(clippy::too_many_arguments)]
    fn run(url: &str, width: u32, height: u32, picture: SharedPicture, state: Arc<Mutex<State>>, ctx: egui::Context, rx: mpsc::Receiver<Cmd>, pid: Arc<AtomicU32>) -> Result<(), String> {
        let err = |e: windows::core::Error| e.message().to_string();
        let werr = |e: webview2_com::Error| format!("{e:?}");
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        let hwnd = host_window(width, height).map_err(err)?;

        // Chromium slows down or stops a page it thinks nobody sees (this one
        // is off the screens): it's told not to.
        let options = CoreWebView2EnvironmentOptions::default();
        unsafe {
            options.set_additional_browser_arguments(
                "--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --autoplay-policy=no-user-gesture-required".to_owned(),
            );
        }
        let folder = dirs::data_local_dir().map(|d| d.join("vibe-clip").join("webview")).unwrap_or_default();
        let folder = HSTRING::from(folder.as_os_str());
        let environment = {
            let (tx, rx) = mpsc::channel();
            let options: ICoreWebView2EnvironmentOptions = options.into();
            CreateCoreWebView2EnvironmentCompletedHandler::wait_for_async_operation(
                Box::new(move |handler| unsafe { CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), &folder, &options, &handler).map_err(webview2_com::Error::WindowsError) }),
                Box::new(move |code, env| {
                    code?;
                    tx.send(env).expect("send");
                    Ok(())
                }),
            )
            .map_err(werr)?;
            rx.recv().map_err(|e| e.to_string())?.ok_or("WebView2 isn't installed")?
        };
        let controller = {
            let (tx, rx) = mpsc::channel();
            let environment = environment.clone();
            CreateCoreWebView2ControllerCompletedHandler::wait_for_async_operation(
                Box::new(move |handler| unsafe { environment.CreateCoreWebView2Controller(hwnd, &handler).map_err(webview2_com::Error::WindowsError) }),
                Box::new(move |code, controller| {
                    code?;
                    tx.send(controller).expect("send");
                    Ok(())
                }),
            )
            .map_err(werr)?;
            rx.recv().map_err(|e| e.to_string())?.ok_or("no WebView2 controller")?
        };
        let webview = unsafe {
            // One page pixel to one pixel, whatever the screens' scaling.
            if let Ok(c3) = windows::core::Interface::cast::<ICoreWebView2Controller3>(&controller) {
                let _ = c3.SetShouldDetectMonitorScaleChanges(false);
                let _ = c3.SetRasterizationScale(1.0);
            }
            // Transparent where the page is.
            if let Ok(c2) = windows::core::Interface::cast::<ICoreWebView2Controller2>(&controller) {
                let _ = c2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR { A: 0, R: 0, G: 0, B: 0 });
            }
            controller.SetBounds(RECT { left: 0, top: 0, right: width as i32, bottom: height as i32 }).map_err(err)?;
            controller.SetIsVisible(true).map_err(err)?;
            controller.CoreWebView2().map_err(err)?
        };
        unsafe {
            let mut p = 0u32;
            if webview.BrowserProcessId(&mut p).is_ok() {
                pid.store(p, Ordering::Relaxed);
            }
            if let Ok(settings) = webview.Settings() {
                let _ = settings.SetAreDefaultContextMenusEnabled(false);
                let _ = settings.SetIsStatusBarEnabled(false);
            }
        }

        // Each picture the screencast sends: put up, and asked for the next.
        let receiver = unsafe { webview.GetDevToolsProtocolEventReceiver(&HSTRING::from("Page.screencastFrame")).map_err(err)? };
        {
            let (webview2, picture, state, ctx) = (webview.clone(), picture.clone(), state.clone(), ctx.clone());
            let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut json = PWSTR::null();
                unsafe { args.ParameterObjectAsJson(&mut json)? };
                let text = webview2_com::take_pwstr(json);
                if let Some((w, h, session)) = super::put_png(&text, &picture) {
                    *state.lock().unwrap() = State::Made(w, h);
                    ctx.request_repaint();
                    call(&webview2, "Page.screencastFrameAck", &format!("{{\"sessionId\":{session}}}"));
                }
                Ok(())
            }));
            let mut token = Default::default();
            unsafe { receiver.add_DevToolsProtocolEventReceived(&handler, &mut token).map_err(err)? };
        }
        // Once a page has loaded: its background see-through, and its pictures sent.
        {
            let webview2 = webview.clone();
            let handler = NavigationCompletedEventHandler::create(Box::new(move |_, _| {
                call(&webview2, "Emulation.setDefaultBackgroundColorOverride", "{\"color\":{\"r\":0,\"g\":0,\"b\":0,\"a\":0}}");
                call(&webview2, "Page.startScreencast", "{\"format\":\"png\",\"everyNthFrame\":1}");
                Ok(())
            }));
            let mut token = Default::default();
            unsafe { webview.add_NavigationCompleted(&handler, &mut token).map_err(err)? };
        }
        unsafe { webview.Navigate(&HSTRING::from(url)).map_err(err)? };

        // Until it's closed: messages, and what it's told.
        let mut msg = MSG::default();
        loop {
            while let Ok(cmd) = rx.try_recv() {
                match cmd {
                    Cmd::Resize(w, h) => unsafe {
                        let _ = SetWindowPos(hwnd, None, -32000, -32000, w as i32, h as i32, SWP_NOACTIVATE | SWP_NOZORDER);
                        let _ = controller.SetBounds(RECT { left: 0, top: 0, right: w as i32, bottom: h as i32 });
                    },
                    Cmd::Mute(m) => unsafe {
                        if let Ok(w8) = windows::core::Interface::cast::<ICoreWebView2_8>(&webview) {
                            let _ = w8.SetIsMuted(m);
                        }
                    },
                    Cmd::Close => {
                        unsafe {
                            let _ = controller.Close();
                            let _ = DestroyWindow(hwnd);
                        }
                        return Ok(());
                    }
                }
            }
            unsafe {
                if GetMessageW(&mut msg, None, 0, 0).0 <= 0 {
                    return Ok(());
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn base64_decodes() {
        assert_eq!(super::base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(super::base64("aGVsbG8").unwrap(), b"hello");
        assert_eq!(super::base64("TWFu").unwrap(), b"Man");
        assert!(super::base64("@@@@").is_none());
    }

    #[test]
    fn see_through_colours_come_out_straight() {
        assert_eq!(super::unpremultiply(vec![0, 64, 0, 128, 255, 0, 0, 255, 9, 9, 9, 0]), [0, 128, 0, 128, 255, 0, 0, 255, 9, 9, 9, 0]);
    }
}
