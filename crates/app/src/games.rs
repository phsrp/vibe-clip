//! Which game is being clipped, for the folder a clip goes in.
//!
//! The app in focus is a game when Discord's list of games knows its
//! executable (it has the best names and icons), when it's installed where game
//! stores put games (`…/steamapps/common/<game>/`, Epic, GOG, Xbox — works
//! offline, and for games Discord doesn't list), or when it's on the games
//! and apps list. Anything else in focus (Explorer, a browser, Discord) is the
//! desktop.
//!
//! While capture runs, a thread notes once a second what's in focus — on its
//! own, as the app may draw no frames while a game covers it. A clip is of
//! what was in focus longest in it: a replay clip's window, a recording's
//! whole length. So clipping a browser with a game open in the background
//! files the clip under Desktop, not the game.
//!
//! With "Record whole sessions" on, it also looks every couple of seconds
//! whether a game on the list is open (see `sessions.rs`), and keeps the
//! moments marked during a recording (Save clip, while recording).

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::discord::Game;

/// What's being captured, as the focus history needs it: clipping and
/// recording can run at once (streaming needs nothing of it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Capturing {
    /// Clipping: clips are of the last this many seconds.
    pub buffer: Option<u32>,
    pub record: bool,
}

#[derive(Default)]
struct State {
    capturing: Capturing,
    /// The games and apps list: (id, name).
    apps: Vec<(String, String)>,
    /// The replay buffer: what was in focus each second, newest last (`None`:
    /// the desktop, or any app that isn't a game).
    recent: VecDeque<Option<String>>,
    /// A recording: seconds in focus, per game (`None`: the desktop).
    totals: HashMap<Option<String>, u32>,
    /// Games by where their app is installed, so the stores' files are read
    /// once per app.
    by_path: HashMap<PathBuf, Option<String>>,
    /// When the recording started.
    started: Option<std::time::Instant>,
    /// A recording: the moments marked in it.
    marks: Vec<std::time::Instant>,
    /// Whether to look if a game on the list is open.
    watching: bool,
    /// A game on the list was open at the last look.
    listed_open: bool,
    /// Games found by how they run (Vibe Clip), by executable (lowercase):
    /// their names. Remembered in the settings.
    detected: HashMap<String, String>,
    /// Apps that aren't games, though they ran like one (by executable).
    not_games: std::collections::HashSet<String>,
    /// Games just found, for the settings to remember: executable, name and
    /// where it is.
    found: Vec<(String, String, PathBuf)>,
}

/// What happened in the game in a clip, as it's saved.
#[derive(Debug, Clone, Default)]
pub struct Details {
    /// For its name: "3 kills on Mirage".
    pub summary: Option<String>,
    /// Each kill: how long before the clip's end, and what it was.
    pub moments: Vec<(Duration, String)>,
    /// A recording's marks: how long before its end each was.
    pub marks: Vec<Duration>,
}

/// Notes what's in focus while capture runs.
#[derive(Clone)]
pub struct Tracker {
    state: Arc<Mutex<State>>,
    /// What happens in the games that report it, for clip names.
    pub events: crate::game_events::Events,
}

impl Tracker {
    pub fn new() -> Self {
        let state: Arc<Mutex<State>> = Default::default();
        let tracker = Self { state, events: crate::game_events::Events::new() };
        let t = tracker.clone();
        std::thread::Builder::new()
            .name("games".into())
            .spawn(move || {
                for tick in 0u64.. {
                    std::thread::sleep(Duration::from_secs(1));
                    sample(&t);
                    if tick % 2 == 0 {
                        look(&t);
                    }
                }
            })
            .expect("spawn games thread");
        tracker
    }

    /// Keep up with the capture and the games and apps list (cheap when
    /// nothing changed). Clipping or a recording that starts starts a new
    /// history of its own.
    pub fn set(&self, capturing: Capturing, apps: &[(String, String)]) {
        let mut s = self.state.lock().unwrap();
        if s.capturing != capturing {
            if capturing.buffer.is_none() || s.capturing.buffer.is_none() {
                s.recent.clear();
            }
            if capturing.record != s.capturing.record {
                s.totals.clear();
                s.marks.clear();
                s.started = capturing.record.then(std::time::Instant::now);
            }
            s.capturing = capturing;
        }
        if s.apps != apps {
            s.apps = apps.to_vec();
        }
    }

    /// The game a replay clip saved now is of: the one in focus longest in the
    /// buffer's window. `None`: the desktop.
    pub fn clip_game(&self) -> Option<String> {
        let s = self.state.lock().unwrap();
        if s.recent.is_empty() {
            // Saved right as the buffer started: what's in focus now.
            drop(s);
            return self.focused().map(|(_, g)| g.name);
        }
        let mut counts: HashMap<&Option<String>, u32> = HashMap::new();
        for g in &s.recent {
            *counts.entry(g).or_default() += 1;
        }
        longest(counts.into_iter().map(|(g, n)| (g.clone(), n)))
    }

    /// What happened in the game in a replay clip saved now ("3 kills on
    /// Mirage", and when each kill was), if the game reports it.
    pub fn clip_details(&self) -> Details {
        let Some(secs) = self.state.lock().unwrap().capturing.buffer else { return Details::default() };
        let now = std::time::Instant::now();
        let Some(since) = now.checked_sub(Duration::from_secs(secs.into())) else { return Details::default() };
        Details { summary: self.events.summary(since), moments: self.events.moments(since, now), marks: Vec::new() }
    }

    /// What happened in the game during the recording that's being stopped,
    /// and the moments marked in it.
    pub fn recording_details(&self) -> Details {
        let s = self.state.lock().unwrap();
        let Some(started) = s.started else { return Details::default() };
        let now = std::time::Instant::now();
        let marks = s.marks.iter().map(|at| now.saturating_duration_since(*at)).collect();
        drop(s);
        Details { summary: self.events.summary(started), moments: self.events.moments(started, now), marks }
    }

    /// Mark this moment in the recording, if one runs. Whether it did.
    pub fn mark(&self) -> bool {
        let mut s = self.state.lock().unwrap();
        if !s.capturing.record {
            return false;
        }
        s.marks.push(std::time::Instant::now());
        true
    }

    /// Look whether a game on the list is open, or stop looking.
    pub fn watch(&self, on: bool) {
        let mut s = self.state.lock().unwrap();
        s.watching = on;
        if !on {
            s.listed_open = false;
        }
    }

    /// A game on the list was open at the last look (while watching).
    pub fn listed_open(&self) -> bool {
        self.state.lock().unwrap().listed_open
    }

    /// The app in focus now and the game it is, if it's one.
    pub fn focused(&self) -> Option<(String, Game)> {
        let (id, path) = capture::foreground_app_path()?;
        let apps = self.state.lock().unwrap().apps.clone();
        let game = identify(&id, &path, self.installed(&path), &apps).or_else(|| self.guess(&id))?;
        Some((id, game))
    }

    /// The games found by how they run, and the apps that aren't games, as
    /// the settings remember them (cheap when nothing changed).
    pub fn set_detection(&self, detected: &std::collections::BTreeMap<String, crate::settings::DetectedGame>, not_games: &[String]) {
        let mut s = self.state.lock().unwrap();
        if s.detected.len() != detected.len() || detected.iter().any(|(exe, g)| s.detected.get(exe) != Some(&g.name)) {
            s.detected = detected.iter().map(|(exe, g)| (exe.clone(), g.name.clone())).collect();
        }
        if s.not_games.len() != not_games.len() || not_games.iter().any(|n| !s.not_games.contains(n)) {
            s.not_games = not_games.iter().cloned().collect();
        }
    }

    /// Games found since last asked: executable, name, and where it is.
    pub fn take_found(&self) -> Vec<(String, String, PathBuf)> {
        std::mem::take(&mut self.state.lock().unwrap().found)
    }

    /// A game no list knows (Vibe Clip), told by how it runs: in focus, it
    /// fills its screen and draws with 3D graphics (or can't be looked into,
    /// as games kept safe by an anti-cheat can't), and it's no everyday app
    /// (a browser or a player full screen) nor one said not to be a game.
    /// Once found it's remembered, windowed too.
    fn guess(&self, id: &str) -> Option<Game> {
        let key = id.to_lowercase();
        {
            let s = self.state.lock().unwrap();
            if let Some(name) = s.detected.get(&key) {
                return Some(Game { name: name.clone(), icon: None });
            }
            if s.not_games.contains(&key) || everyday_app(&key) {
                return None;
            }
        }
        let facts = capture::focus_facts().filter(|f| f.exe.eq_ignore_ascii_case(id))?;
        if !facts.fills_screen || facts.draws_3d == Some(false) {
            return None;
        }
        let name = game_name(&facts);
        let mut s = self.state.lock().unwrap();
        s.detected.insert(key, name.clone());
        s.found.push((facts.exe.clone(), name.clone(), facts.path.clone()));
        Some(Game { name, icon: None })
    }

    /// [`installed_game`], read once per app.
    fn installed(&self, path: &Path) -> Option<String> {
        if let Some(known) = self.state.lock().unwrap().by_path.get(path) {
            return known.clone();
        }
        // Outside the lock: reading the stores' files can take a moment.
        let found = installed_game(path);
        self.state.lock().unwrap().by_path.insert(path.to_path_buf(), found.clone());
        found
    }

    /// The game a recording stopped now is of: the one in focus longest.
    pub fn recording_game(&self) -> Option<String> {
        let s = self.state.lock().unwrap();
        if s.totals.is_empty() {
            drop(s);
            return self.focused().map(|(_, g)| g.name);
        }
        longest(s.totals.iter().map(|(g, n)| (g.clone(), *n)))
    }
}

/// The game with the most seconds (a game over the desktop on a tie, then
/// by name, so the pick doesn't wobble).
fn longest(counts: impl Iterator<Item = (Option<String>, u32)>) -> Option<String> {
    counts.max_by(|(a, n), (b, m)| n.cmp(m).then(a.is_some().cmp(&b.is_some())).then(b.cmp(a))).and_then(|(g, _)| g)
}

/// Note what's in focus now.
fn sample(tracker: &Tracker) {
    let state = &tracker.state;
    let capturing = state.lock().unwrap().capturing;
    if capturing.buffer.is_none() && !capturing.record {
        return;
    }
    let game = tracker.focused().map(|(_, g)| g.name);
    let mut s = state.lock().unwrap();
    if let Some(secs) = s.capturing.buffer {
        s.recent.push_back(game.clone());
        while s.recent.len() > secs.max(1) as usize {
            s.recent.pop_front();
        }
    }
    if s.capturing.record {
        *s.totals.entry(game).or_default() += 1;
    }
}

/// Look whether a game on the list is open (has a window), while watching.
fn look(tracker: &Tracker) {
    let apps = {
        let s = tracker.state.lock().unwrap();
        if !s.watching {
            return;
        }
        s.apps.clone()
    };
    let open = !apps.is_empty() && {
        let windowed = capture::list_windowed_apps();
        apps.iter().any(|(id, _)| windowed.iter().any(|w| w.id.eq_ignore_ascii_case(id)))
    };
    let mut s = tracker.state.lock().unwrap();
    // Turned off while looking: stays off.
    s.listed_open = open && s.watching;
}

/// The game an app is, if it's one: Discord's name for it, else its store
/// folder's (`by_place`), else its name on the games and apps list.
fn identify(id: &str, path: &Path, by_place: Option<String>, apps: &[(String, String)]) -> Option<Game> {
    crate::discord::known_game(id, path)
        .or_else(|| by_place.map(|name| Game { name, icon: None }))
        .or_else(|| apps.iter().find(|(a, _)| a.eq_ignore_ascii_case(id)).map(|(_, name)| Game { name: name.clone(), icon: None }))
}

/// Where a game found by how it runs keeps its icon (by executable).
pub fn icon_file(exe: &str) -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("vibe-clip").join("game-icons").join(format!("{}.png", exe.to_lowercase())))
}

/// Keep the icon of a game just found (while it runs: only then is its
/// executable's place known), on a thread of its own.
pub fn keep_icon(exe: String) {
    std::thread::spawn(move || {
        let (Some(file), Some(rgba)) = (icon_file(&exe), capture::app_icon(&exe, 64)) else { return };
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Err(e) = image::save_buffer(&file, &rgba, 64, 64, image::ColorType::Rgba8) {
            eprintln!("games: couldn't keep {exe}'s icon: {e}");
        }
    });
}

/// Apps that fill the screen and draw with the graphics card without being
/// games: browsers and players watched full screen, chat, launchers, the
/// shell, editors and 3D tools (by executable, lowercase).
fn everyday_app(exe: &str) -> bool {
    const EVERYDAY: &[&str] = &[
        // Browsers
        "chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "opera_gx.exe", "brave.exe", "vivaldi.exe", "arc.exe", "iexplore.exe", "librewolf.exe", "zen.exe", "floorp.exe", "waterfox.exe", "msedgewebview2.exe",
        // Video and music
        "vlc.exe", "mpc-hc64.exe", "mpc-hc.exe", "mpc-be64.exe", "potplayermini64.exe", "potplayermini.exe", "mpv.exe", "wmplayer.exe", "video.ui.exe", "microsoft.media.player.exe", "music.ui.exe", "spotify.exe", "netflix.exe", "plex.exe", "kodi.exe", "stremio.exe",
        // Chat and calls
        "discord.exe", "discordptb.exe", "discordcanary.exe", "slack.exe", "teams.exe", "ms-teams.exe", "zoom.exe", "telegram.exe", "whatsapp.exe", "signal.exe",
        // Windows itself
        "explorer.exe", "searchhost.exe", "startmenuexperiencehost.exe", "shellexperiencehost.exe", "applicationframehost.exe", "lockapp.exe", "textinputhost.exe", "taskmgr.exe", "mstsc.exe", "systemsettings.exe", "screenclippinghost.exe", "snippingtool.exe", "photos.exe", "microsoft.photos.exe", "dwm.exe", "magnify.exe",
        // Launchers and stores (Steam's Big Picture is full screen)
        "steam.exe", "steamwebhelper.exe", "epicgameslauncher.exe", "battle.net.exe", "riotclientux.exe", "riotclientservices.exe", "galaxyclient.exe", "eadesktop.exe", "ubisoftconnect.exe", "upc.exe", "xboxpcapp.exe", "gamebar.exe", "playnite.desktopapp.exe", "playnite.fullscreenapp.exe", "heroic.exe", "itch.exe",
        // Recording and streaming
        "obs64.exe", "obs32.exe", "vibe-clip.exe", "vibe clip.exe", "hasteclip.exe", "medal.exe", "streamlabs obs.exe", "nvidia app.exe", "nvidia overlay.exe", "radeonsoftware.exe",
        // Editing, office and 3D tools
        "code.exe", "devenv.exe", "notepad.exe", "notepad++.exe", "idea64.exe", "rider64.exe", "pycharm64.exe", "blender.exe", "unity.exe", "unrealeditor.exe", "godot.exe", "photoshop.exe", "afterfx.exe", "adobe premiere pro.exe", "resolve.exe", "davinci resolve.exe", "kdenlive.exe", "vegas.exe", "gimp-2.10.exe", "krita.exe", "clipstudiopaint.exe", "figma.exe", "winword.exe", "excel.exe", "powerpnt.exe", "onenote.exe", "acrobat.exe", "acrord32.exe", "sumatrapdf.exe", "vmware.exe", "virtualboxvm.exe", "vmconnect.exe",
    ];
    EVERYDAY.contains(&exe)
}

/// What a game found by how it runs is called: its executable's
/// description (what Task Manager shows), unless that says nothing (an
/// engine's "UnityPlayer", "Game"); else its window's title; else its
/// executable's name.
fn game_name(f: &capture::FocusFacts) -> String {
    let stem = f.exe.strip_suffix(".exe").or_else(|| f.exe.strip_suffix(".EXE")).unwrap_or(&f.exe).to_owned();
    let tidy = |s: &str| {
        let mut s = s.trim().to_owned();
        for tail in [" (64-bit)", " (32-bit)", " (x64)", " (DirectX 11)", " (DirectX 12)", " (Vulkan)", "-Win64-Shipping", " Win64 Shipping", "-Shipping"] {
            if let Some(t) = s.strip_suffix(tail) {
                s = t.trim().to_owned();
            }
        }
        s
    };
    let says_nothing = |s: &str| {
        let l = s.to_lowercase();
        l.len() < 2 || ["game", "launcher", "application", "app", "client", "main", "unityplayer", "unity player", "unity", "unreal engine", "godot engine", "player", "shipping"].contains(&l.as_str())
    };
    if let Some(d) = f.description.as_deref().map(tidy).filter(|d| !says_nothing(d)) {
        return d;
    }
    let title = tidy(&f.title);
    if !says_nothing(&title) && title.chars().count() <= 60 {
        return title;
    }
    tidy(&stem)
}

/// Where a clip goes: the folder of its game (`None`: Desktop) in the
/// library, or a folder it's been renamed to (`renamed`), or the library
/// itself without folders per game.
pub fn folder_for(lib: &Path, per_game: bool, renamed: &std::collections::BTreeMap<String, String>, game: Option<&str>) -> PathBuf {
    if !per_game {
        return lib.to_path_buf();
    }
    let folder = crate::clips::folder_name(game.unwrap_or(crate::clips::DESKTOP));
    lib.join(renamed.get(&folder).cloned().unwrap_or(folder))
}

/// A game, by where it's installed: in a Steam library (named as Steam does),
/// an Epic game (as the Epic launcher does), or in GOG's or the Xbox app's
/// games folder (by its folder).
pub fn installed_game(exe: &Path) -> Option<String> {
    let parts: Vec<String> = exe.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let after = |a: &str, b: Option<&str>| -> Option<usize> {
        (0..parts.len()).find(|&i| parts[i].eq_ignore_ascii_case(a) && b.is_none_or(|b| parts.get(i + 1).is_some_and(|p| p.eq_ignore_ascii_case(b))))
            .map(|i| i + if b.is_some() { 2 } else { 1 })
    };
    // The game's folder must hold the app, not be it.
    let folder = |i: usize| (i + 1 < parts.len()).then(|| parts[i].clone());
    if let Some((_, dir)) = capture::stores::steam_dir(exe) {
        return Some(capture::stores::steam_game(exe).map(|g| g.name).unwrap_or(dir));
    }
    if let Some(game) = capture::stores::epic_game(exe) {
        return Some(game.name);
    }
    if let Some(i) = after("GOG Galaxy", Some("Games")).or_else(|| after("GOG Games", None)) {
        return folder(i);
    }
    if let Some(i) = after("XboxGames", None) {
        return folder(i);
    }
    None
}

#[cfg(test)]
mod guess_tests {
    use super::*;

    fn facts(exe: &str, description: Option<&str>, title: &str) -> capture::FocusFacts {
        capture::FocusFacts { exe: exe.into(), path: PathBuf::from(exe), title: title.into(), description: description.map(Into::into), fills_screen: true, draws_3d: Some(true) }
    }

    #[test]
    fn found_games_are_named_by_what_they_say() {
        assert_eq!(game_name(&facts("hollow_knight.exe", Some("Hollow Knight"), "Hollow Knight")), "Hollow Knight");
        assert_eq!(game_name(&facts("Game.exe", Some("UnityPlayer"), "Cozy Farm Days")), "Cozy Farm Days", "an engine's description says nothing");
        assert_eq!(game_name(&facts("Bloop-Win64-Shipping.exe", None, "")), "Bloop", "the executable, tidied");
        assert_eq!(game_name(&facts("x.exe", Some("Rally Racer (64-bit)"), "")), "Rally Racer");
    }

    #[test]
    fn everyday_apps_are_not_games() {
        assert!(everyday_app("chrome.exe") && everyday_app("vlc.exe") && everyday_app("blender.exe"));
        assert!(!everyday_app("hollow_knight.exe"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn games_by_folder() {
        let steam = std::env::temp_dir().join(format!("hc-steam-{}", std::process::id())).join("steamapps");
        std::fs::create_dir_all(steam.join("common")).unwrap();
        std::fs::write(
            steam.join("appmanifest_730.acf"),
            "\"AppState\"\n{\n\t\"appid\"\t\t\"730\"\n\t\"name\"\t\t\"Counter-Strike 2\"\n\t\"installdir\"\t\t\"Counter-Strike Global Offensive\"\n\t\"UserConfig\"\n\t{\n\t\t\"name\"\t\t\"other\"\n\t}\n}\n",
        )
        .unwrap();
        let cs = steam.join("common").join("Counter-Strike Global Offensive").join("game").join("bin").join("win64").join("cs2.exe");
        assert_eq!(installed_game(&cs).as_deref(), Some("Counter-Strike 2"));
        // No manifest for it: the folder's name.
        let other = steam.join("common").join("Some Game").join("game.exe");
        assert_eq!(installed_game(&other).as_deref(), Some("Some Game"));
        // The common folder itself isn't a game.
        assert_eq!(installed_game(&steam.join("common").join("stray.exe")), None);
        std::fs::remove_dir_all(steam.parent().unwrap()).unwrap();

    }

    /// Windows paths: they only parse as such on Windows.
    #[cfg(windows)]
    #[test]
    fn games_by_store_folder() {
        assert_eq!(installed_game(Path::new(r"C:\Program Files (x86)\GOG Galaxy\Games\Cyberpunk 2077\bin\x64\Cyberpunk2077.exe")).as_deref(), Some("Cyberpunk 2077"));
        assert_eq!(installed_game(Path::new(r"D:\XboxGames\Halo Infinite\Content\HaloInfinite.exe")).as_deref(), Some("Halo Infinite"));
        assert_eq!(installed_game(Path::new(r"C:\Windows\explorer.exe")), None);
        assert_eq!(installed_game(Path::new(r"C:\Program Files\Google\Chrome\Application\chrome.exe")), None);
    }

    #[test]
    fn longest_in_focus() {
        let g = |s: &str| Some(s.to_owned());
        assert_eq!(longest([(g("CS"), 20), (None, 40)].into_iter()), None);
        assert_eq!(longest([(g("CS"), 40), (None, 20)].into_iter()), g("CS"));
        // A tie goes to the game.
        assert_eq!(longest([(g("CS"), 30), (None, 30)].into_iter()), g("CS"));
        assert_eq!(longest(std::iter::empty()), None);
    }
}
