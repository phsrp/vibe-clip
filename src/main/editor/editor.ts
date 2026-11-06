// The clip editor's background work: timeline pictures (thumbnail strip + waveform) and exporting
// the edit (kept parts joined together, optionally cropped) as a new clip with FFmpeg.
import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { EditExportRequest, EditStrip } from '@shared/types'
import { createLogger } from '../logger'
import { mediaUrl } from '../library/protocol'
import * as library from '../library/library'
import { getDb, type ClipRow } from '../library/db'
import { probe } from '../library/media'
import { resolveEncoder } from '../engine/encoders'
import { getSettings } from '../settings'

const log = createLogger('editor')

function ffmpegPath(): string {
  return path.join(path.dirname(require.resolve('obs-studio-node')).replace('app.asar', 'app.asar.unpacked'), 'ffmpeg.exe')
}

function thumbsDir(): string {
  const dir = path.join(app.getPath('userData'), 'thumbs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function run(args: string[], timeout = 120000): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(ffmpegPath(), args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, _o, stderr) =>
      err ? reject(new Error((stderr || err.message).trim().split('\n').slice(-2).join(' '))) : resolve()
    )
  )
}

/** Thumbnail strip (one image with N frames side by side) and an audio waveform picture for the timeline. */
export async function makeStrip(clipId: number): Promise<EditStrip> {
  const row = getDb().prepare('SELECT * FROM clips WHERE id = ?').get(clipId) as ClipRow | undefined
  if (!row) throw new Error('Clip not found')
  const info = await probe(row.path)
  const count = 24
  const strip = path.join(thumbsDir(), `strip_${clipId}.jpg`)
  const wave = path.join(thumbsDir(), `wave_${clipId}.png`)
  const fresh = (f: string) => fs.existsSync(f) && fs.statSync(f).mtimeMs >= fs.statSync(row.path).mtimeMs
  if (!fresh(strip)) {
    const rate = Math.max(count / Math.max(info.duration, 0.1), 0.01)
    await run(['-y', '-v', 'error', '-i', row.path, '-vf', `fps=${rate.toFixed(5)},scale=160:-2,tile=${count}x1`, '-frames:v', '1', '-q:v', '5', strip])
  }
  let waveOk = true
  if (!fresh(wave)) {
    try {
      await run(['-y', '-v', 'error', '-i', row.path, '-filter_complex', '[0:a:0]aformat=channel_layouts=mono,showwavespic=s=2400x80:colors=white:scale=sqrt', '-frames:v', '1', wave])
    } catch (e) {
      log.warn('No waveform (clip may have no audio)', e)
      waveOk = false
    }
  }
  return {
    duration: info.duration,
    width: info.width,
    height: info.height,
    strip: mediaUrl(strip),
    stripCount: count,
    wave: waveOk && fs.existsSync(wave) ? mediaUrl(wave) : null,
    audioStreams: await audioStreamCount(row.path)
  }
}

async function audioStreamCount(file: string): Promise<number> {
  return new Promise((resolve) => {
    const probePath = ffmpegPath().replace('ffmpeg.exe', 'ffprobe.exe')
    execFile(probePath, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { windowsHide: true }, (err, out) =>
      resolve(err ? 0 : out.trim().split(/\r?\n/).filter(Boolean).length)
    )
  })
}

let current: ChildProcess | null = null
let cancelled = false

/** Which FFmpeg H.264 encoder to use, matching the GPU your recordings use. */
function exportEncoder(): string {
  const id = resolveEncoder(getSettings().encoder)
  if (id.includes('nvenc')) return 'h264_nvenc'
  if (id.includes('amf')) return 'h264_amf'
  if (id.includes('qsv')) return 'h264_qsv'
  return 'libx264'
}

function encoderArgs(enc: string): string[] {
  if (enc === 'h264_nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0']
  if (enc === 'h264_amf') return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '19', '-qp_p', '21']
  if (enc === 'h264_qsv') return ['-c:v', 'h264_qsv', '-global_quality', '20']
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18']
}

function buildFilter(req: EditExportRequest, audio: number): { filter: string; maps: string[] } {
  const parts: string[] = []
  const concatIn: string[] = []
  req.segments.forEach((s, i) => {
    parts.push(`[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`)
    concatIn.push(`[v${i}]`)
    for (let a = 0; a < audio; a++) {
      parts.push(`[0:a:${a}]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}_${a}]`)
      concatIn.push(`[a${i}_${a}]`)
    }
  })
  const outs = ['[vcat]', ...Array.from({ length: audio }, (_, a) => `[aout${a}]`)]
  parts.push(`${concatIn.join('')}concat=n=${req.segments.length}:v=1:a=${audio}${outs.join('')}`)
  let vLabel = '[vcat]'
  if (req.crop) {
    const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
    parts.push(`[vcat]crop=${even(req.crop.width)}:${even(req.crop.height)}:${Math.round(req.crop.x)}:${Math.round(req.crop.y)}[vout]`)
    vLabel = '[vout]'
  }
  return { filter: parts.join(';'), maps: [vLabel, ...outs.slice(1)] }
}

/** Exports the edit as a new clip next to the original. Calls onProgress with 0..1. */
export async function exportEdit(req: EditExportRequest, onProgress: (p: number) => void): Promise<number | null> {
  const row = getDb().prepare('SELECT * FROM clips WHERE id = ?').get(req.clipId) as ClipRow | undefined
  if (!row) throw new Error('Clip not found')
  if (!req.segments.length) throw new Error('Nothing to export: every part was removed')
  const audio = await audioStreamCount(row.path)
  const total = req.segments.reduce((t, s) => t + (s.end - s.start), 0)
  const dir = path.dirname(row.path)
  const base = path.parse(row.path).name.replace(/ \(edited( \d+)?\)$/, '')
  let out = path.join(dir, `${base} (edited).mp4`)
  for (let i = 2; fs.existsSync(out); i++) out = path.join(dir, `${base} (edited ${i}).mp4`)

  const { filter, maps } = buildFilter(req, audio)
  const attempt = (enc: string) =>
    new Promise<void>((resolve, reject) => {
      const args = ['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', '-i', row.path, '-filter_complex', filter]
      for (const m of maps) args.push('-map', m)
      args.push(...encoderArgs(enc), '-pix_fmt', 'yuv420p')
      if (audio) args.push('-c:a', 'aac', '-b:a', '192k')
      args.push('-movflags', '+faststart', out)
      log.info(`Exporting ${req.segments.length} part(s), ${total.toFixed(1)}s, ${enc}${req.crop ? ', cropped' : ''} -> ${out}`)
      const p = spawn(ffmpegPath(), args, { windowsHide: true })
      current = p
      let err = ''
      p.stdout.on('data', (d: Buffer) => {
        const m = /out_time_us=(\d+)/.exec(d.toString())
        if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / Math.max(total, 0.1)))
      })
      p.stderr.on('data', (d: Buffer) => (err += d.toString()))
      p.on('close', (code) => {
        current = null
        if (cancelled) reject(new Error('cancelled'))
        else if (code === 0) resolve()
        else reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `FFmpeg exited with code ${code}`))
      })
    })

  cancelled = false
  library.markBusy(out, true)
  try {
    const enc = exportEncoder()
    try {
      await attempt(enc)
    } catch (e) {
      if (cancelled || enc === 'libx264') throw e
      log.warn(`${enc} export failed, retrying with x264`, e)
      onProgress(0)
      await attempt('libx264')
    }
  } catch (e) {
    fs.rmSync(out, { force: true })
    if (cancelled) return null
    throw e
  } finally {
    library.markBusy(out, false)
  }
  onProgress(1)
  const id = await library.addFile(out, {
    kind: row.kind === 'screenshot' ? 'clip' : row.kind,
    game: row.game,
    gameName: row.game_name,
    title: `${row.title} (edited)`
  })
  return id
}

export function cancelExport(): void {
  if (current) {
    cancelled = true
    current.kill()
  }
}
