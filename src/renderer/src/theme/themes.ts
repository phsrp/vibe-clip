export const THEMES = [
  { id: 'default', name: 'Default Dark' },
  { id: 'gruvbox', name: 'Gruvbox Dark' },
  { id: 'rose-pine', name: 'Rosé Pine' }
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export function applyTheme(id: string): void {
  document.documentElement.dataset.theme = id
  // Tell the background process so the Windows title-bar buttons match.
  const css = getComputedStyle(document.documentElement)
  window.api.setTitleBarColors(css.getPropertyValue('--bg-window').trim(), css.getPropertyValue('--text-muted').trim())
}
