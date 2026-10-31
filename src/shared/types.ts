export type ThemeMode = 'light' | 'dark' | 'system'
export type MotionMode = 'system' | 'on' | 'off'

export interface PingResult {
  label: string
  target: string
  /** Average round trip in ms, null if nothing answered. */
  ms: number | null
  ok: boolean
  /** Share of probes that got no answer, 0-100. */
  lossPct: number
  /** Mean change between consecutive round trips, in ms. */
  jitterMs: number
}

/** The three numbers the home screen needs, without the full diagnostic run. */
export interface QuickReport {
  gateway: string | null
  routerMs: number | null
  internetMs: number | null
  online: boolean
}

export interface DnsBenchmarkRow {
  label: string
  server: string
  ms: number | null
  /** The server the system is using right now. */
  current: boolean
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

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

export type AdapterKind = 'wifi' | 'ethernet'
export type AdapterStatus = 'up' | 'disconnected' | 'disabled'

export interface AdapterView {
  name: string
  description: string
  kind: AdapterKind
  status: AdapterStatus
  /** Link speed while connected, e.g. "1 Gbps"; empty otherwise. */
  speed: string
  /** A performance boost is applied and can be reverted. */
  boosted: boolean
}

export interface AdapterActionResult {
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
  motion: MotionMode
  autoUpdate: boolean
  hasRouterPassword: boolean
}

export interface PlatformInfo {
  platform: 'win32' | 'darwin' | 'linux'
  version: string
  isAdmin: boolean
}
