// Friendly names for OBS filter and transition ids (OBS shows these names in its own menus).
export const FILTER_NAMES: Record<string, { label: string; audio: boolean }> = {
  mask_filter_v2: { label: 'Image mask / blend', audio: false },
  crop_filter: { label: 'Crop / pad', audio: false },
  gain_filter: { label: 'Gain', audio: true },
  basic_eq_filter: { label: '3-band equalizer', audio: true },
  hdr_tonemap_filter: { label: 'HDR tone mapping', audio: false },
  color_filter_v2: { label: 'Color correction', audio: false },
  scale_filter: { label: 'Scaling / aspect ratio', audio: false },
  scroll_filter: { label: 'Scroll', audio: false },
  gpu_delay: { label: 'Render delay', audio: false },
  color_key_filter_v2: { label: 'Color key', audio: false },
  clut_filter: { label: 'Apply LUT', audio: false },
  sharpness_filter_v2: { label: 'Sharpen', audio: false },
  chroma_key_filter_v2: { label: 'Chroma key (green screen)', audio: false },
  async_delay_filter: { label: 'Video delay (async)', audio: false },
  noise_suppress_filter_v2: { label: 'Noise suppression', audio: true },
  invert_polarity_filter: { label: 'Invert polarity', audio: true },
  noise_gate_filter: { label: 'Noise gate', audio: true },
  compressor_filter: { label: 'Compressor', audio: true },
  limiter_filter: { label: 'Limiter', audio: true },
  expander_filter: { label: 'Expander', audio: true },
  upward_compressor_filter: { label: 'Upward compressor', audio: true },
  luma_key_filter_v2: { label: 'Luma key', audio: false },
  vst_filter: { label: 'VST 2.x plugin', audio: true },
  nv_greenscreen_filter: { label: 'NVIDIA background removal', audio: false },
  nv_audiofx_filter: { label: 'NVIDIA noise removal', audio: true }
}

export const TRANSITION_NAMES: Record<string, string> = {
  cut_transition: 'Cut',
  fade_transition: 'Fade',
  swipe_transition: 'Swipe',
  slide_transition: 'Slide',
  shuffle_transition: 'Shuffle',
  obs_stinger_transition: 'Stinger (video)',
  fade_to_color_transition: 'Fade to color',
  wipe_transition: 'Luma wipe',
  motion_transition: 'Move'
}

/** Filters to show in the "Add filter" menu: the current version of each, with a friendly name. */
export function filterChoices(types: string[]): { id: string; label: string; audio: boolean }[] {
  return types
    .filter((t) => FILTER_NAMES[t])
    .map((t) => ({ id: t, ...FILTER_NAMES[t] }))
    .sort((a, b) => Number(a.audio) - Number(b.audio) || a.label.localeCompare(b.label))
}
