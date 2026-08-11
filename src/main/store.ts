import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { ThemeMode } from '../shared/types'

interface StoredConfig {
  theme: ThemeMode
  autoUpdate: boolean
  /** Router password, encrypted by the OS keystore. Base64 of the cipher text. */
  routerPassword?: string
}

const DEFAULTS: StoredConfig = { theme: 'system', autoUpdate: true }

function configPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: StoredConfig | null = null

function load(): StoredConfig {
  if (cache) return cache
  try {
    const raw = readFileSync(configPath(), 'utf8')
    cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<StoredConfig>) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

function persist(next: StoredConfig): void {
  cache = next
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 })
}

export function getTheme(): ThemeMode {
  return load().theme
}

export function setTheme(theme: ThemeMode): void {
  persist({ ...load(), theme })
}

export function getAutoUpdate(): boolean {
  return load().autoUpdate
}

export function setAutoUpdate(autoUpdate: boolean): void {
  persist({ ...load(), autoUpdate })
}

export function hasRouterPassword(): boolean {
  return Boolean(load().routerPassword)
}

/**
 * The router password is handed to the OS keystore - DPAPI on Windows,
 * Keychain on macOS, libsecret on Linux - so it never sits on disk in a form
 * another user of the machine can read. If no keystore is available we refuse
 * to store it rather than fall back to something that only looks encrypted.
 */
export function setRouterPassword(plain: string): { ok: boolean; error?: string } {
  if (!plain) {
    persist({ ...load(), routerPassword: undefined })
    return { ok: true }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      error:
        'Sistemul nu oferă un seif de parole disponibil. Parola nu a fost salvată - ar fi rămas în clar pe disc.',
    }
  }
  persist({ ...load(), routerPassword: safeStorage.encryptString(plain).toString('base64') })
  return { ok: true }
}

export function getRouterPassword(): string | null {
  const stored = load().routerPassword
  if (!stored || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null
  }
}

export function configFileExists(): boolean {
  return existsSync(configPath())
}
