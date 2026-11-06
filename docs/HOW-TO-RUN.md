# Vibe Clip: how to run and test

## Run it

Double-click **`start.bat`**, or open a terminal in this folder and run:

```
npm run dev
```

The first time, `npm install` downloads the OBS engine (~300 MB). After that it starts in a few seconds.
Close the terminal (or use **Quit** in the tray menu) to stop it.

## What to test (Phase 1)

| What | How | What you should see |
|---|---|---|
| Engine | Start the app | Top right says **Replay 3:00** with a pulsing dot. If the engine fails, a red banner explains why. |
| Save a clip | Play something, press **Alt+F10** | A "Clip saved" pop-up (top-right of your screen if the app isn't focused). The clip appears under **Today** with a thumbnail. |
| Record | Click **Record** (or **Alt+F9**), wait, click **Stop** | A timer while recording, then "Recording saved". It shows up as an MP4. |
| Screenshot | Press **Alt+F12** | "Screenshot saved"; it shows under the screenshots filter. |
| Game detection | Open osu!, CS2 or Geometry Dash, wait ~5 s | The status pill shows the game name. Clips go into that game's folder and sidebar entry; osu! clips are named after the song. |
| Play a clip | Double-click a card | Built-in player. Ctrl+← / Ctrl+→ for previous/next, Esc closes. |
| Rename / delete / collections | Right-click a card | Rename inline; Delete moves the file to the Recycle Bin; "Add to collection" after you make one with **New collection**. |
| Search | Ctrl+F | Filters by title and game. |
| Tray | Close the window | The app keeps running in the tray (purple circle by the clock). Right-click it for Save clip / Record / Quit. |
| Themes | Settings → Appearance | Default Dark, Gruvbox Dark, Rosé Pine. |
| Import from OBS | Settings → Import from OBS → Find OBS profiles | A list of what will be imported; click **Import these settings**. |

## Where things are

- **Clips**: `Videos\Vibe Clip\<Game>\` (change in Settings)
- **Settings, database, thumbnails, logs**: `%APPDATA%\Vibe Clip\`
- **App log**: Settings → **Open logs** (`logs\app.log`)
- **OBS engine log**: `%APPDATA%\Vibe Clip\obs-data\node-obs\logs\`

## If something goes wrong

- **Black recording**: the app checks this automatically and switches capture method. If it still warns, see the message for what to do.
- **Hotkey doesn't work**: another app may use it; Settings shows an error toast. Pick different keys.
- **Game shows your desktop instead of the game**: game capture couldn't hook in (anti-cheat, or the game runs as administrator). Clips still record the display.
- Send the `app.log` file when asking for help.

## Roll back

Every step is a git commit: `git log --oneline` lists them, `git checkout <id>` goes back.

## License note

The OBS engine (obs-studio-node) is GPL-2.0. That's fine for personal use; if you ever share the app,
its source must be shared under the GPL too.
