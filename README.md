# Vibe Clip

A clip recorder and editor for Windows: it keeps the last few minutes of your game ready, so you can press a key when something happens, trim it and share it.

> **Vibe Clip is a modified version of [HasteClip](https://github.com/hasteclip/hasteclip) by Kaillr.**
> Nearly all of it (the recorder, frame blending, editor, player, library and interface) is HasteClip's work, used under the GNU GPL v3. Vibe Clip is not HasteClip, and isn't made or endorsed by its authors. If you want the original, get [HasteClip](https://github.com/hasteclip/hasteclip/releases/latest).

## What's different from HasteClip

Changed by phsrp, starting 9 November 2026 (every change is in this repository's history, after HasteClip's own commits):

- Renamed to Vibe Clip, with its own icon, data folders and updates (from this repository's releases).
- Removed saving clips by voice.
- Removed share links (they upload to HasteClip's own server).
- Discord activity shows Vibe Clip, through its own Discord application.

Planned:

- Themes: Default, Gruvbox and Rosé Pine, each in dark and light.
- Change the speed of each part of a clip in the editor.
- Recording to MKV.
- Customisable audio tracks.
- Browser, image and text sources (overlays), with sound from browser sources.
- A new save sound.

## Building from source

You need [Rust](https://rustup.rs) (stable) and [ffmpeg](https://ffmpeg.org) on your `PATH` or next to the app (`winget install Gyan.FFmpeg`). Then:

```sh
git clone https://github.com/phsrp/vibe-clip.git
cd vibe-clip
cargo run --release
```

`pwsh scripts/fetch-game-hook.ps1` puts OBS Studio's game capture hook in `target/game-hook`, where a development build finds it. These are signed GPLv2 files that run as separate programs. Without them, games are recorded with Windows' own capture only.

| Crate | Purpose |
|---|---|
| `crates/app` | The desktop app (egui): library, player, editor, sources, settings |
| `crates/capture` | Screen and audio capture, mixing, encoding and writing files |
| `crates/media` | Probing, preview decoding and rendering edits |

## License

Vibe Clip, like HasteClip, is free software under the [GNU General Public License, version 3 or later](LICENSE). Its source is available here, and HasteClip's copyright notices are kept.

The name "HasteClip" and its icon belong to HasteClip and aren't used by Vibe Clip; see [TRADEMARKS.md](TRADEMARKS.md).

The releases bundle [ffmpeg](https://ffmpeg.org) (GPL), the [Hanken Grotesk](https://fonts.google.com/specimen/Hanken+Grotesk) font (SIL Open Font License), [Phosphor icons](https://phosphoricons.com) (MIT), and [OBS Studio](https://obsproject.com)'s game capture hook (GPL-2.0-or-later).
