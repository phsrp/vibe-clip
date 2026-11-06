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
import { encryptSecret } from '../../secrets'

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
  const replay = obsHotkey(hk['OBSBasic.StartReplayBuffer'], 'bindings')
  const stream = obsHotkey(hk['OBSBasic.StartStreaming'], 'bindings')
  if (save || rec || shot || replay || stream) {
    patch.hotkeys = {
      ...current.hotkeys,
      ...(save && { saveReplay: save }),
      ...(rec && { toggleRecording: rec }),
      ...(shot && { screenshot: shot }),
      ...(replay && { toggleReplay: replay }),
      ...(stream && { toggleStream: stream })
    }
    imported.push(
      'Hotkeys: ' +
        [save && `save clip ${save}`, rec && `record ${rec}`, shot && `screenshot ${shot}`, replay && `replay buffer ${replay}`, stream && `stream ${stream}`]
          .filter(Boolean)
          .join(', ')
    )
  }

  // Canvas size and exact frame rate
  if (Number(v.BaseCX) && Number(v.BaseCY)) {
    patch.baseResolution = `${v.BaseCX}x${v.BaseCY}`
    imported.push(`Canvas: ${v.BaseCX}×${v.BaseCY}`)
  }
  if (outH && Number(v.OutputCX)) patch.outputResolution = outH === baseH ? 'native' : `${v.OutputCX}x${v.OutputCY}`
  if (fpsType === 2 && Number(v.FPSNum)) {
    patch.fps = Number(v.FPSNum)
    patch.fpsDen = Number(v.FPSDen) || 1
  } else if (fpsType === 0 && v.FPSCommon && v.FPSCommon.includes('.')) {
    const f = Number(v.FPSCommon)
    patch.fps = Math.round(f) * 1000
    patch.fpsDen = 1001
  } else {
    patch.fpsDen = 1
  }
  const scale: Record<string, AppSettings['downscaleFilter']> = { bilinear: 'bilinear', bicubic: 'bicubic', lanczos: 'lanczos', area: 'area' }
  if (v.ScaleType && scale[v.ScaleType]) patch.downscaleFilter = scale[v.ScaleType]
  if (['NV12', 'I420', 'I444', 'BGRA'].includes(v.ColorFormat)) patch.colorFormat = v.ColorFormat as AppSettings['colorFormat']
  const space: Record<string, AppSettings['colorSpace']> = { '601': '601', '709': '709', sRGB: 'sRGB', '2100PQ': '2100PQ', '2100HLG': '2100HLG' }
  if (space[v.ColorSpace]) patch.colorSpace = space[v.ColorSpace]
  if (v.ColorRange) patch.colorRange = v.ColorRange === 'Full' ? 'full' : 'partial'
  if (v.ColorFormat) imported.push(`Colors: ${v.ColorFormat}, ${v.ColorSpace ?? '709'}, ${v.ColorRange ?? 'Partial'} range`)

  // Audio
  const a = ini.Audio ?? {}
  if (a.SampleRate === '44100' || a.SampleRate === '48000') patch.sampleRate = Number(a.SampleRate) as 44100 | 48000
  const ch: Record<string, AppSettings['channels']> = { Mono: 'mono', Stereo: 'stereo', '2.1': '2.1', '4.0': '4.0', '4.1': '4.1', '5.1': '5.1', '7.1': '7.1' }
  if (a.ChannelSetup && ch[a.ChannelSetup]) patch.channels = ch[a.ChannelSetup]
  if (a.SampleRate) imported.push(`Audio: ${a.SampleRate} Hz, ${a.ChannelSetup ?? 'Stereo'}`)
  if (advanced) {
    patch.tracks = current.tracks.map((t, i) => ({
      name: ini.AdvOut?.[`Track${i + 1}Name`] || t.name,
      bitrate: Number(ini.AdvOut?.[`Track${i + 1}Bitrate`]) || t.bitrate
    }))
    const recTracks = Number(out.RecTracks)
    if (recTracks > 0) {
      patch.recordTracks = recTracks & 63
      patch.replayTracks = recTracks & 63
      imported.push(`Recorded audio tracks: ${[1, 2, 3, 4, 5, 6].filter((t) => recTracks & (1 << (t - 1))).join(', ')}`)
    }
  }

  // Recording file options
  const fmt = (out.RecFormat2 ?? out.RecFormat ?? '').toLowerCase()
  if (fmt) {
    patch.recordingFormat = fmt.includes('mkv') ? 'mkv' : fmt.includes('mov') ? 'mov' : 'mp4'
    imported.push(`Recording format: ${patch.recordingFormat.toUpperCase()}${fmt === patch.recordingFormat ? '' : ` (from ${fmt})`}`)
  }
  if (ini.Output?.FilenameFormatting) patch.filenameFormat = ini.Output.FilenameFormatting
  if (advanced && out.RecSplitFile !== undefined) {
    patch.splitRecording = {
      enabled: out.RecSplitFile === 'true',
      type: out.RecSplitFileType === 'Size' ? 'size' : 'time',
      minutes: Number(out.RecSplitFileTime) || 15,
      megabytes: Number(out.RecSplitFileSize) || 2048
    }
    if (patch.splitRecording.enabled) imported.push(`Split recordings every ${patch.splitRecording.type === 'time' ? `${patch.splitRecording.minutes} min` : `${patch.splitRecording.megabytes} MB`}`)
  }

  // Streaming service (service.json holds the platform, server and stream key)
  const service = readJson(path.join(folder, 'service.json')) as { type?: string; settings?: Record<string, unknown> } | null
  if (service?.type) {
    const ss = service.settings ?? {}
    const key = String(ss.key ?? ss.bearer_token ?? '')
    patch.stream = {
      ...current.stream,
      serviceType: service.type,
      service: String(ss.service ?? current.stream.service),
      server: String(ss.server ?? 'auto'),
      keyEncrypted: key ? encryptSecret(key) : current.stream.keyEncrypted,
      bitrate: Number((readJson(path.join(folder, 'streamEncoder.json')) ?? {}).bitrate) || Number(ini.SimpleOutput?.VBitrate) || current.stream.bitrate,
      track: advanced ? Number(ini.AdvOut?.TrackIndex) || 1 : 1
    }
    imported.push(`Streaming: ${service.type === 'rtmp_common' ? ss.service : 'custom server'}${key ? ' (stream key included, stored encrypted)' : ''}`)
  }

  skipped.push('Scenes and sources: use "Import scene collection" below to bring them in as profiles')

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
