// The OBS engine's TypeScript types declare its enums as "const enum", which don't exist
// at runtime in our build. These are the same numeric values, copied from obs-studio-node.

export const VideoFormat = { NV12: 2 } as const
export const ColorSpace = { CS709: 2 } as const
export const RangeType = { Partial: 1 } as const
export const ScaleType = { Bilinear: 3, Bicubic: 2, Lanczos: 4 } as const
export const FPSType = { Fractional: 2 } as const
export const BoundsType = { None: 0, ScaleInner: 2 } as const
export const Alignment = { TopLeft: 5, Center: 0 } as const

/** Output (recording / replay buffer) error codes reported in signals. */
export const OutputCode: Record<number, string> = {
  0: 'Success',
  [-1]: 'Bad path: the output folder is missing or not writable',
  [-2]: 'Connection failed',
  [-3]: 'Invalid stream',
  [-4]: 'Generic output error',
  [-5]: 'Disconnected',
  [-6]: 'Unsupported format or encoder',
  [-7]: 'Not enough disk space',
  [-8]: 'Encoder error: the video encoder failed to start (try another encoder or lower settings)',
  [-65]: 'Outdated GPU driver: update your graphics driver'
}

/** OBS engine startup result codes. */
export const InitCode: Record<number, string> = {
  0: 'Success',
  [-1]: 'OBS engine failed to start',
  [-2]: 'Graphics not supported: DirectX 11 could not start (update your GPU driver)',
  [-3]: 'Invalid parameter',
  [-4]: 'Already active',
  [-5]: 'A required OBS module is missing'
}

/** Audio output channels, same layout OBS Studio uses. */
export const Channel = { Video: 0, DesktopAudio: 1, Mic: 3 } as const

/** Audio tracks (bitmask). Track 1 = everything mixed, 2 = desktop/game, 3 = mic. */
export const Tracks = { Mixed: 1, Desktop: 2, Mic: 4 } as const
