import { contextBridge, ipcRenderer } from 'electron'
import type {
  AdapterActionResult,
  AdapterView,
  AppSettings,
  DiagnosticsReport,
  MotionMode,
  PlatformInfo,
  DnsBenchmarkRow,
  QuickReport,
  SpeedProgress,
  ThemeMode,
  UpdateState,
  ToolRunResult,
  ToolView,
} from '../shared/types'

/**
 * The only surface the renderer gets. Each call is a named message the main
 * process validates - no channel names, no ipcRenderer, no Node reach through
 * this bridge.
 */
const api = {
  getPlatformInfo: (): Promise<PlatformInfo> => ipcRenderer.invoke('platform:info'),
  runDiagnostics: (): Promise<DiagnosticsReport> => ipcRenderer.invoke('diagnostics:run'),
  getGateway: (): Promise<string | null> => ipcRenderer.invoke('network:gateway'),
  quickCheck: (fresh = false): Promise<QuickReport> => ipcRenderer.invoke('network:quick', fresh),
  benchmarkDns: (): Promise<DnsBenchmarkRow[]> => ipcRenderer.invoke('dns:benchmark'),

  listTools: (): Promise<ToolView[]> => ipcRenderer.invoke('tools:list'),
  runTool: (id: string): Promise<ToolRunResult> => ipcRenderer.invoke('tools:run', id),

  listAdapters: (): Promise<AdapterView[]> => ipcRenderer.invoke('adapters:list'),
  setAdapterEnabled: (name: string, enable: boolean): Promise<AdapterActionResult> =>
    ipcRenderer.invoke('adapters:toggle', name, enable),
  boostAdapter: (name: string): Promise<AdapterActionResult> =>
    ipcRenderer.invoke('adapters:boost', name),
  revertAdapter: (name: string): Promise<AdapterActionResult> =>
    ipcRenderer.invoke('adapters:revert', name),

  /** Mb/s, or null if the user stopped the test. */
  startSpeedTest: (): Promise<number | null> => ipcRenderer.invoke('speed:start'),
  cancelSpeedTest: (): Promise<void> => ipcRenderer.invoke('speed:cancel'),
  onSpeedProgress: (cb: (p: SpeedProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: SpeedProgress): void => cb(p)
    ipcRenderer.on('speed:progress', listener)
    return () => ipcRenderer.removeListener('speed:progress', listener)
  },

  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb: (state: UpdateState) => void): (() => void) => {
    const listener = (_e: unknown, state: UpdateState): void => cb(state)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },

  openRouter: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('router:open'),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:openExternal', url),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setTheme: (mode: ThemeMode): Promise<boolean> => ipcRenderer.invoke('settings:setTheme', mode),
  setMotion: (mode: MotionMode): Promise<boolean> => ipcRenderer.invoke('settings:setMotion', mode),
  setAutoUpdate: (value: boolean): Promise<boolean> =>
    ipcRenderer.invoke('settings:setAutoUpdate', value),
  setRouterPassword: (value: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setPassword', value),
  revealRouterPassword: (): Promise<string | null> =>
    ipcRenderer.invoke('settings:revealPassword'),
}

export type NetworkDoctorApi = typeof api

contextBridge.exposeInMainWorld('api', api)
