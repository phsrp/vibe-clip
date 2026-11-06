export const THEMES = [
  { id: 'default', name: 'Default' },
  { id: 'gruvbox', name: 'Gruvbox' },
  { id: 'rose-pine', name: 'Rosé Pine' }
] as const

export type ThemeId = (typeof THEMES)[number]['id']
export type ThemeMode = 'dark' | 'light'

/** Each theme has a dark and a light version. */
export function applyTheme(id: string, mode: ThemeMode = 'dark'): void {
  document.documentElement.dataset.theme = id
  document.documentElement.dataset.mode = mode
  // Tell the background process so the Windows title-bar buttons match.
  const css = getComputedStyle(document.documentElement)
  window.api.setTitleBarColors(css.getPropertyValue('--bg-window').trim(), css.getPropertyValue('--text-muted').trim())
}
