// Types shared by the background process (main) and the UI (renderer).

export interface EncoderInfo {
  id: string
  label: string
  hardware: boolean
}

export interface EngineStatus {
  running: boolean
  error: string | null
  encoders: EncoderInfo[]
  inputTypes: string[]
}

export type ClipKind = 'clip' | 'recording' | 'screenshot'

export interface Clip {
  id: number
  path: string
  title: string
  kind: ClipKind
  /** Game id from the games list, or "desktop". */
  game: string
  gameName: string
  /** Unix time in milliseconds. */
  createdAt: number
  /** Seconds. 0 for screenshots. */
  duration: number
  /** Bytes. */
  size: number
  width: number
  height: number
  /** URL the UI can load (thumbnail image), or null while it's being made. */
  thumb: string | null
  /** URL the built-in player can load. */
  url: string
  shared: boolean
  collections: number[]
}

export interface GameSummary {
  id: string
  name: string
  count: number
  /** URL of the game's icon, or null to use a generic icon. */
  icon: string | null
}

export interface Collection {
  id: number
  name: string
  count: number
  cover: string | null
}

export interface LibrarySnapshot {
  clips: Clip[]
  games: GameSummary[]
  collections: Collection[]
}

/** Which clips the sidebar is showing. */
export type LibraryView =
  | { type: 'all' }
  | { type: 'shared' }
  | { type: 'game'; id: string }
  | { type: 'collection'; id: number }

export type KindFilter = 'all' | 'clips' | 'screenshots'
export type SortOrder = 'newest' | 'oldest' | 'largest' | 'longest'

export interface CaptureStatus {
  replayActive: boolean
  replaySeconds: number
  recording: boolean
  /** Unix ms when recording started. */
  recordingSince: number | null
  game: string | null
  gameName: string | null
}

export type OutputResolution = 'native' | '2160' | '1440' | '1080' | '900' | '720'

export interface Hotkeys {
  saveReplay: string
  toggleRecording: string
  screenshot: string
}

export interface AppSettings {
  theme: string
  /** Where clips, recordings and screenshots are saved. */
  outputFolder: string
  // Video
  outputResolution: OutputResolution
  fps: number
  /** "auto" = best available (NVENC > AMF > QuickSync > x264). */
  encoder: string
  /** Kbps. */
  bitrate: number
  // Replay buffer
  replayEnabled: boolean
  replaySeconds: number
  // Capture
  /** auto: capture the game when one is detected, otherwise the display. display: always the display. */
  captureMode: 'auto' | 'display'
  /** OBS monitor id, or "" for the primary monitor. */
  monitorId: string
  desktopAudio: boolean
  desktopAudioDevice: string
  mic: boolean
  micDevice: string
  // Hotkeys (Electron accelerator strings, e.g. "Alt+F10")
  hotkeys: Hotkeys
  // App
  minimizeToTray: boolean
  /** Extra games added by the user. */
  customGames: GameDefinition[]
}

export interface GameDefinition {
  id: string
  name: string
  /** Process names to look for, e.g. ["osu!.exe"]. Case-insensitive. */
  processes: string[]
}

export interface DeviceOption {
  id: string
  name: string
}

export interface CaptureOptions {
  monitors: DeviceOption[]
  desktopAudioDevices: DeviceOption[]
  micDevices: DeviceOption[]
  encoders: EncoderInfo[]
}

export type ToastKind = 'success' | 'error' | 'info'
export interface ToastMessage {
  id: number
  kind: ToastKind
  title: string
  detail?: string
}
