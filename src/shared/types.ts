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
