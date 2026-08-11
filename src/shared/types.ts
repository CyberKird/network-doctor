export type ThemeMode = 'light' | 'dark' | 'system'

export interface PingResult {
  label: string
  target: string
  ms: number | null
  ok: boolean
}

export interface DiagnosticsReport {
  online: boolean
  gateway: string | null
  ipConfig: string
  pings: PingResult[]
  dnsResolves: boolean
}

export interface ToolView {
  id: string
  label: string
  available: boolean
  reason?: string
  elevated: boolean
  confirm: boolean
}

export interface ToolRunResult {
  ok: boolean
  message: string
}

export interface SpeedProgress {
  mbps: number
  bytes: number
  done: boolean
}

export interface AppSettings {
  theme: ThemeMode
  autoUpdate: boolean
  hasRouterPassword: boolean
}

export interface PlatformInfo {
  platform: 'win32' | 'darwin' | 'linux'
  version: string
  isAdmin: boolean
}
