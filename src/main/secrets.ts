// Stores secrets (your stream key) encrypted with Windows' own per-user protection (DPAPI),
// so the key isn't readable as plain text in settings.json.
import { safeStorage } from 'electron'

export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (!safeStorage.isEncryptionAvailable()) return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
  return safeStorage.encryptString(plain).toString('base64')
}

export function decryptSecret(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8')
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return ''
  }
}
