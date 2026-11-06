# Vibe Clip: how to install, run and test

## Install (the finished app)

Run **`release\Vibe Clip Setup 1.0.0.exe`**. Windows may show "Windows protected your PC" because the app
isn't code-signed: click **More info → Run anyway**. Pick a folder, finish, and Vibe Clip opens.
It adds Start menu and desktop shortcuts. Uninstall it from Windows Settings → Apps.

## Run from the source code (for development)

Double-click **`start.bat`**, or: `npm run dev`. Build a new installer with `npm run dist` (→ `release\`).

## What to test

### Clips (the library)
| What | How | What you should see |
|---|---|---|
| Save a clip | Play something, press **Alt+F10** | "Clip saved" pop-up (top-right of your screen). The clip appears under **Today**. |
| Record | **Record** button or **Alt+F9**, then stop | A timer while recording, then "Recording saved". |
| Screenshot | **Alt+F12** | "Screenshot saved", shown under the screenshots filter. |
| Game detection | Open osu!, CS2 or Geometry Dash | The status pill shows the game; clips go under that game; osu! clips are named after the song. |
| Play / browse | Double-click a card | Built-in player. Ctrl+← / → for previous/next. |
| Organise | Right-click a card | Rename, add to collection, show in folder, delete (to Recycle Bin), **Edit**. |

### Editor
Right-click a clip → **Edit** (or the Edit button in the player).
Drag the ends of a part to trim · **S** splits at the playhead · **Delete** removes the selected part · **C** crops
(choose 16:9, 9:16, 1:1...) · **Ctrl+Z / Ctrl+Y** undo/redo · **Save as new clip** exports (the original is never changed).

### Sources (profiles = what OBS calls scenes)
| What | How |
|---|---|
| Switch profile | Click a profile on the left (with the transition you picked). Each profile can have its own hotkey. |
| Add a source | **Add** → display, window, game capture, auto game capture, webcam, mic, desktop/app audio, image, slideshow, text, media, browser, color. |
| Change a source | Click it: **Settings** (every OBS option), **Position** (fit, stretch, corners, exact position/size/crop), **Audio** (volume, monitoring, sync, which of the 6 tracks), **Filters** (all OBS filters: chroma key, color correction, noise suppression, compressor...). |
| Mixer | Volume faders with live meters, mute, and always-on audio devices (desktop audio, mics, one app). |
| Live preview | The picture at the top is exactly what gets recorded. It pauses while a menu is open. |

### Settings
General · Video (canvas, output, downscale filter, FPS incl. 59.94) · Recording (encoder + every encoder option, format,
tracks, file names, split files) · Replay buffer · Audio (sample rate, channels, monitoring device, track names/bitrates) ·
Streaming (Twitch/YouTube/… or custom server, stream key stored encrypted, separate stream encoder, reconnect, delay) ·
Advanced (color format/space/range) · Hotkeys · Games · **Import from OBS** (your OBS settings and your scenes as profiles).

### Streaming
Set up Settings → Streaming, then **Go live** at the top of the Clips page (or the tray menu / a hotkey).
The button shows time live and bitrate; **End stream** stops it.

## Updates (same scheme as Vibe Editing Suite and Hearth)

The installed app checks GitHub Releases (`phsrp/Vibe-Clip`) a couple of seconds after it opens and **asks** before
downloading: **Download** → **Restart now** (or **Later**: it installs when you next quit). **Remind me later** hides
it for 4 hours; an "Update x.y" badge stays in the title bar. Settings → General has **Automatic updates** and
**Check for updates**. Before installing, a running recording is saved and the OBS engine is stopped.

**Publishing a new version:**
1. Bump `version` in `package.json` (e.g. 1.0.1) and rewrite `RELEASE_NOTES.md` (short "- " lines: they become the
   release text and the popup's "What's new" list).
2. Commit, then `git push origin main`.
3. `git tag -a v1.0.1 -m "v1.0.1"` and `git push origin v1.0.1`.
4. GitHub Actions (`.github/workflows/release.yml`) builds and publishes the release. The tag must equal
   `v` + the package.json version (the workflow checks this).

## Where things are
- **Clips**: `Videos\Vibe Clip\<Game>\` (change in Settings)
- **Settings, profiles, database, thumbnails, logs**: `%APPDATA%\Vibe Clip\`
- **App log**: Settings → **Open logs** · **OBS engine log**: `%APPDATA%\Vibe Clip\obs-data\node-obs\logs\`

## If something goes wrong
- **Black recording**: checked automatically; the app switches capture method and tells you if it's still black.
- **Hotkey doesn't work**: another app may use it; a message says which. Pick different keys.
- **Game records your desktop instead**: game capture couldn't hook in (anti-cheat, or the game runs as admin).
- **Stream won't start**: the message says whether the key or the connection is the problem.
- Send `app.log` when asking for help.

## License
The OBS engine (obs-studio-node) is GPL-2.0: fine for personal use; if you share the app, its source must be shared too.
