// Finds installed games on this PC and saves their icons, so the library shows real game icons
// straight away (not only after the game has been running with Vibe Clip open).
import { app } from 'electron'
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { GameDefinition } from '@shared/types'
import { createLogger } from '../logger'
import { iconsDir } from './detector'

const log = createLogger('game-icons')

/** "%LOCALAPPDATA%\\osu!" -> "C:\\Users\\you\\AppData\\Local\\osu!" */
function expand(p: string): string {
  return p.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? '')
}

function exists(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

let steamLibraries: Promise<string[]> | null = null

/** Every Steam library folder on this PC (from Steam's own libraryfolders.vdf). */
function findSteamLibraries(): Promise<string[]> {
  steamLibraries ??= new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (err, out) => {
      const m = !err && /SteamPath\s+REG_SZ\s+(.+)/.exec(out)
      const steam = m ? path.normalize(m[1].trim()) : path.join(expand('%PROGRAMFILES(X86)%'), 'Steam')
      const libs = new Set<string>([steam])
      try {
        const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8')
        for (const x of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.normalize(x[1].replace(/\\\\/g, '\\')))
      } catch {
        /* no Steam */
      }
      resolve([...libs])
    })
  })
  return steamLibraries
}

/** Looks for the game's .exe in the places it usually lives. */
export async function findGameExe(game: GameDefinition): Promise<string | null> {
  const hints = game.installHints
  if (!hints) return null
  for (const p of hints.paths ?? []) {
    const full = expand(p)
    if (exists(full)) return full
  }
  for (const dir of hints.versionDirs ?? []) {
    const base = expand(dir)
    const exe = hints.versionExe ?? game.processes[0]
    try {
      const versions = fs
        .readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(base, d.name, exe))
        .filter(exists)
      if (versions.length) return versions[versions.length - 1]
    } catch {
      /* not installed there */
    }
  }
  if (hints.steam) {
    for (const lib of await findSteamLibraries()) {
      const full = path.join(lib, 'steamapps', 'common', hints.steam)
      if (exists(full)) return full
    }
  }
  return null
}

/** Saves icons for any games that don't have one yet. Returns true if it found new ones. */
export async function findGameIcons(games: GameDefinition[]): Promise<boolean> {
  let found = false
  for (const game of games) {
    const file = path.join(iconsDir(), `${game.id}.png`)
    if (fs.existsSync(file)) continue
    try {
      const exe = await findGameExe(game)
      if (!exe) continue
      const icon = await app.getFileIcon(exe, { size: 'large' })
      if (icon.isEmpty()) continue
      fs.writeFileSync(file, icon.toPNG())
      log.info(`Found ${game.name} at ${exe}`)
      found = true
    } catch (e) {
      log.warn(`Could not get the icon for ${game.name}`, e)
    }
  }
  return found
}
