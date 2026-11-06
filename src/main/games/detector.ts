// Watches running programs and reports when a known game starts or stops.
import { app, nativeImage } from 'electron'
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { GameDefinition } from '@shared/types'
import { createLogger } from '../logger'
import { allGames } from './games'

const log = createLogger('games')

export interface RunningGame {
  def: GameDefinition
  pid: number
  exe: string
}

function run(cmd: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out)))
  )
}

/** Lists running processes as { name, pid } using Windows' built-in tasklist. */
async function listProcesses(): Promise<{ name: string; pid: number }[]> {
  const out = await run('tasklist', ['/fo', 'csv', '/nh'])
  const list: { name: string; pid: number }[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line)
    if (m) list.push({ name: m[1], pid: Number(m[2]) })
  }
  return list
}

export class GameDetector {
  private timer: NodeJS.Timeout | null = null
  private current: RunningGame | null = null
  private checking = false
  onChange: ((game: RunningGame | null) => void) | null = null
  /** Called after every check (every few seconds), so window titles can be refreshed. */
  onTick: ((game: RunningGame | null) => void) | null = null
  onIcon: ((gameId: string, iconPath: string) => void) | null = null

  start(intervalMs = 3000): void {
    if (this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get game(): RunningGame | null {
    return this.current
  }

  async check(): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const procs = await listProcesses()
      const byName = new Map<string, { name: string; pid: number }>()
      for (const p of procs) byName.set(p.name.toLowerCase(), p)
      let found: RunningGame | null = null
      for (const def of allGames()) {
        for (const exe of def.processes) {
          const p = byName.get(exe.toLowerCase())
          if (p) {
            found = { def, pid: p.pid, exe: p.name }
            break
          }
        }
        if (found) break
      }
      if (found?.def.id !== this.current?.def.id || found?.pid !== this.current?.pid) {
        log.info(found ? `Game detected: ${found.def.name} (${found.exe}, pid ${found.pid})` : `Game closed: ${this.current?.def.name}`)
        this.current = found
        this.onChange?.(found)
        if (found) void this.saveIcon(found)
      }
      this.onTick?.(this.current)
    } catch (e) {
      log.warn('Process check failed', e)
    } finally {
      this.checking = false
    }
  }

  /** Saves the game's .exe icon so the sidebar can show it. */
  private async saveIcon(game: RunningGame): Promise<void> {
    const file = path.join(iconsDir(), `${game.def.id}.png`)
    if (fs.existsSync(file)) return
    try {
      const exePath = (
        await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${game.pid}).Path`])
      ).trim()
      if (!exePath) return
      const icon = await app.getFileIcon(exePath, { size: 'large' })
      if (icon.isEmpty()) return
      fs.writeFileSync(file, icon.toPNG())
      log.info(`Saved icon for ${game.def.name}`)
      this.onIcon?.(game.def.id, file)
    } catch (e) {
      log.warn(`Could not get icon for ${game.def.name}`, e)
    }
  }
}

export function iconsDir(): string {
  const dir = path.join(app.getPath('userData'), 'game-icons')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** All saved game icons, as { gameId: filePath }. */
export function savedIcons(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fs.readdirSync(iconsDir())) {
    if (f.endsWith('.png') && !nativeImage.createFromPath(path.join(iconsDir(), f)).isEmpty()) out[f.slice(0, -4)] = path.join(iconsDir(), f)
  }
  return out
}

/** OBS window strings look like "Title:WindowClass:game.exe", with ":" inside parts written as "#3A". */
export function parseWindowString(s: string): { title: string; cls: string; exe: string } {
  const [title = '', cls = '', exe = ''] = s.split(':')
  const dec = (x: string) => x.replace(/#3A/g, ':')
  return { title: dec(title), cls: dec(cls), exe: dec(exe) }
}

/**
 * Turns a game's window title into a clip name, e.g. osu!'s
 * "osu! - Camellia - Shoujo A [Lost]" → "Shoujo A [Lost]". Returns null if the title is just the game name.
 */
export function detailFromTitle(title: string, gameName: string): string | null {
  const t = title.trim()
  if (!t || t.toLowerCase() === gameName.toLowerCase()) return null
  const parts = t.split(' - ').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const last = parts[parts.length - 1]
  if (last.toLowerCase().includes(gameName.toLowerCase())) return null
  return last.slice(0, 120)
}
