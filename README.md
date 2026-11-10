# Vibe Clip

A clip recorder and editor for Windows: it keeps the last few minutes of your game ready, so you can press a key when something happens, trim it and share it.

> **Vibe Clip is a modified version of [HasteClip](https://github.com/hasteclip/hasteclip) by Kaillr.**
> Nearly all of it (the recorder, frame blending, editor, player, library and interface) is HasteClip's work, used under the GNU GPL v3. Vibe Clip is not HasteClip, and isn't made or endorsed by its authors. If you want the original, get [HasteClip](https://github.com/hasteclip/hasteclip/releases/latest).

> [!TIP]
> **Consider using HasteClip instead.** Vibe Clip is one person's small fork, and nearly everything good in it was designed and built by Kaillr in [HasteClip](https://github.com/hasteclip/hasteclip). HasteClip gets new features and fixes first, and it's made by the person who knows it best. If you only want a great clip recorder, [get HasteClip](https://github.com/hasteclip/hasteclip/releases/latest), and if you like it, [support Kaillr on Ko-fi](https://ko-fi.com/kaillr).

## What's different from HasteClip

Changed by phsrp, starting 9 November 2026 (every change is in this repository's history, after HasteClip's own commits):

- Renamed to Vibe Clip, with its own icon, data folders and updates (from this repository's releases).
- Themes: Default (HasteClip's look), Gruvbox and Rosé Pine, each in dark and light (Settings → App).
- Clips trimmed by other recorders (Medal's, with an MP4 edit list) play with their sound in sync.
- The editor can change the speed of each part of a clip (right-click a part → Speed), keeping voices' pitch.
- Custom audio tracks like OBS's (Sources → Sound → Tracks): named, in your order, shared by any sources.
- Games that no list knows are found by how they run (full screen and drawing 3D).
- The mouse wheel scrolls as many lines a notch as Windows does (egui's own is one).

Misc:
- Removed saving clips by voice.
- Removed share links (they upload to HasteClip's own server).
- Discord activity shows Vibe Clip, through its own Discord application.

Kept up to date with HasteClip: last merged HasteClip 0.8.0 (scenes, presets, image, text, video and web page sources, going live).


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
