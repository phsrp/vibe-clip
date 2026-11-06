// Reads OBS Studio profiles (%APPDATA%/obs-studio/basic/profiles/<name>/) and turns them into
// Vibe Clip settings: output folder, resolution, fps, encoder (+ its exact settings), bitrate,
// replay buffer length and hotkeys. Nothing in your OBS folder is changed.
// Phase 2 will add scene collections (sources, audio tracks) here, shown as "profiles" in the app.
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AppSettings, ObsProfilePreview, OutputResolution } from '@shared/types'
import { createLogger } from '../../logger'
import { availableEncoders, KNOWN_ENCODERS } from '../../engine/encoders'

const log = createLogger('obs-import')

type Ini = Record<string, Record<string, string>>

export function obsConfigDir(): string {
  return path.join(app.getPath('appData'), 'obs-studio')
}

function parseIni(text: string): Ini {
  const out: Ini = {}
  let section = ''
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sec = /^\[(.+)\]$/.exec(line)
    if (sec) {
      section = sec[1]
      out[section] ??= {}
      continue
    }
    const eq = line.indexOf('=')
    if (eq > 0 && section) out[section][line.slice(0, eq)] = line.slice(eq + 1)
  }
  return out
}

/** OBS writes Windows paths with doubled backslashes. */
function iniPath(v: string | undefined): string | undefined {
  if (!v) return undefined
  return path.normalize(v.replace(/\\\\/g, '\\'))
}

// OBS "Simple" output mode uses short names for encoders.
const SIMPLE_ENCODERS: Record<string, string> = {
  x264: 'obs_x264',
  obs_x264: 'obs_x264',
  nvenc: 'obs_nvenc_h264_tex',
  jim_nvenc: 'obs_nvenc_h264_tex',
  amd: 'h264_texture_amf',
  qsv: 'obs_qsv11_v2'
}

const RESOLUTIONS: OutputResolution[] = ['2160', '1440', '1080', '900', '720']

/** Turns an OBS hotkey binding into an Electron accelerator like "Alt+F10". */
function obsHotkey(json: string | undefined, name: string): string | undefined {
  if (!json) return undefined
  try {
    const data = JSON.parse(json) as Record<string, { key: string; alt?: boolean; control?: boolean; shift?: boolean; command?: boolean }[]>
    const b = (data[name] ?? data.bindings ?? [])[0]
    if (!b?.key) return undefined
    let key = b.key.replace(/^OBS_KEY_/, '')
    if (/^NUM\d$/.test(key)) key = 'num' + key.slice(3)
    else if (!/^(F\d{1,2}|[A-Z]|\d|INSERT|DELETE|HOME|END|PAGEUP|PAGEDOWN|PAUSE|PRINT|SPACE|UP|DOWN|LEFT|RIGHT)$/.test(key)) return undefined
    const map: Record<string, string> = { INSERT: 'Insert', DELETE: 'Delete', HOME: 'Home', END: 'End', PAGEUP: 'PageUp', PAGEDOWN: 'PageDown', PAUSE: 'Pause', PRINT: 'PrintScreen', SPACE: 'Space', UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right' }
    key = map[key] ?? key
    const parts = [b.control && 'Ctrl', b.alt && 'Alt', b.shift && 'Shift', key].filter(Boolean)
    return parts.join('+')
  } catch {
    return undefined
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function readProfile(folder: string, current: AppSettings): ObsProfilePreview {
  const ini = parseIni(fs.readFileSync(path.join(folder, 'basic.ini'), 'utf8'))
  const name = ini.General?.Name ?? path.basename(folder)
  const advanced = ini.Output?.Mode === 'Advanced'
  const out = advanced ? (ini.AdvOut ?? {}) : (ini.SimpleOutput ?? {})
  const patch: Partial<AppSettings> = {}
  const imported: string[] = []
  const skipped: string[] = []

  // Save folder
  const folderPath = iniPath(advanced ? out.RecFilePath : out.FilePath)
  if (folderPath) {
    patch.outputFolder = folderPath
    imported.push(`Save folder: ${folderPath}`)
  }

  // Resolution + fps
  const v = ini.Video ?? {}
  const baseH = Number(v.BaseCY)
  const outH = Number(v.OutputCY)
  if (outH) {
    if (outH === baseH) patch.outputResolution = 'native'
    else patch.outputResolution = RESOLUTIONS.reduce((best, r) => (Math.abs(Number(r) - outH) < Math.abs(Number(best) - outH) ? r : best), '1080' as OutputResolution)
    imported.push(`Resolution: ${v.OutputCX}×${v.OutputCY}${patch.outputResolution !== 'native' && Number(patch.outputResolution) !== outH ? ` (closest option: ${patch.outputResolution}p)` : ''}`)
  }
  const fpsType = Number(v.FPSType ?? 0)
  const fps = fpsType === 1 ? Number(v.FPSInt) : fpsType === 2 ? Number(v.FPSNum) / Number(v.FPSDen || 1) : Number(v.FPSCommon ?? 30)
  if (fps > 0) {
    patch.fps = Math.round(fps)
    imported.push(`Frame rate: ${Math.round(fps)} fps`)
  }

  // Encoder
  let encoderId: string | undefined
  if (advanced) {
    encoderId = out.RecEncoder && out.RecEncoder !== 'none' ? out.RecEncoder : out.Encoder
  } else {
    encoderId = SIMPLE_ENCODERS[out.RecEncoder ?? out.StreamEncoder ?? '']
  }
  if (encoderId === 'jim_nvenc') encoderId = 'obs_nvenc_h264_tex'
  const available = availableEncoders().map((e) => e.id)
  if (encoderId && available.includes(encoderId)) {
    patch.encoder = encoderId
    imported.push(`Encoder: ${KNOWN_ENCODERS.find((e) => e.id === encoderId)?.label ?? encoderId}`)
  } else if (encoderId) {
    skipped.push(`Encoder "${encoderId}" isn't supported yet (H.264 only for now), so Auto is used`)
    patch.encoder = 'auto'
  }

  // Encoder settings (bitrate, rate control, preset...) exactly as OBS had them
  const encSettings = advanced ? readJson(path.join(folder, out.RecEncoder === 'none' ? 'streamEncoder.json' : 'recordEncoder.json')) : null
  if (encSettings && patch.encoder && patch.encoder !== 'auto') {
    patch.encoderOverrides = { id: patch.encoder, settings: encSettings }
    const rc = String(encSettings.rate_control ?? 'CBR')
    if (typeof encSettings.bitrate === 'number' && (rc === 'CBR' || rc === 'VBR')) {
      patch.bitrate = encSettings.bitrate
      imported.push(`Bitrate: ${encSettings.bitrate / 1000} Mbps (${rc})`)
    } else if (rc === 'CQP' || rc === 'CRF') {
      imported.push(`Quality mode: ${rc} ${encSettings.cqp ?? encSettings.crf ?? ''} (kept exactly as in OBS)`)
    }
    const extras = Object.keys(encSettings).filter((k) => !['bitrate', 'rate_control'].includes(k))
    if (extras.length) imported.push(`Encoder options: ${extras.join(', ')}`)
  } else if (!advanced && out.VBitrate) {
    patch.bitrate = Number(out.VBitrate)
    imported.push(`Bitrate: ${Number(out.VBitrate) / 1000} Mbps`)
  }

  // Replay buffer
  if (out.RecRB !== undefined) {
    patch.replayEnabled = out.RecRB === 'true'
    imported.push(`Replay buffer: ${patch.replayEnabled ? 'on' : 'off'}`)
  }
  if (out.RecRBTime) {
    patch.replaySeconds = Math.max(5, Math.min(1200, Number(out.RecRBTime)))
    imported.push(`Replay length: ${patch.replaySeconds} seconds`)
  }

  // Hotkeys
  const hk = ini.Hotkeys ?? {}
  const save = obsHotkey(hk.ReplayBuffer, 'ReplayBuffer.Save')
  const rec = obsHotkey(hk['OBSBasic.StartRecording'], 'bindings')
  const shot = obsHotkey(hk['OBSBasic.Screenshot'], 'bindings')
  if (save || rec || shot) {
    patch.hotkeys = { ...current.hotkeys, ...(save && { saveReplay: save }), ...(rec && { toggleRecording: rec }), ...(shot && { screenshot: shot }) }
    imported.push(
      'Hotkeys: ' + [save && `save clip ${save}`, rec && `record ${rec}`, shot && `screenshot ${shot}`].filter(Boolean).join(', ')
    )
  }

  // Things this version doesn't use yet
  if (advanced && Number(out.RecTracks) > 1) skipped.push('Recording audio tracks: Vibe Clip always saves 3 tracks (mixed, desktop, mic) for now')
  if (out.RecFormat2) skipped.push(`Recording format "${out.RecFormat2}": Vibe Clip saves MP4`)
  skipped.push('Scenes and sources (your scene collection) will be importable as profiles in a later version')

  log.info(`Read OBS profile "${name}": ${imported.length} settings`)
  return { name, folder, patch, imported, skipped }
}

export function listProfiles(current: AppSettings): ObsProfilePreview[] {
  const dir = path.join(obsConfigDir(), 'basic', 'profiles')
  if (!fs.existsSync(dir)) return []
  const out: ObsProfilePreview[] = []
  for (const name of fs.readdirSync(dir)) {
    const folder = path.join(dir, name)
    if (!fs.existsSync(path.join(folder, 'basic.ini'))) continue
    try {
      out.push(readProfile(folder, current))
    } catch (e) {
      log.error(`Could not read OBS profile ${name}`, e)
    }
  }
  return out
}
