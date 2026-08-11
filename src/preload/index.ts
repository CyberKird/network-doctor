import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  DiagnosticsReport,
  PlatformInfo,
  SpeedProgress,
  ThemeMode,
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

  listTools: (): Promise<ToolView[]> => ipcRenderer.invoke('tools:list'),
  runTool: (id: string): Promise<ToolRunResult> => ipcRenderer.invoke('tools:run', id),

  startSpeedTest: (): Promise<number> => ipcRenderer.invoke('speed:start'),
  cancelSpeedTest: (): Promise<void> => ipcRenderer.invoke('speed:cancel'),
  onSpeedProgress: (cb: (p: SpeedProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: SpeedProgress): void => cb(p)
    ipcRenderer.on('speed:progress', listener)
    return () => ipcRenderer.removeListener('speed:progress', listener)
  },

  onUpdateAvailable: (cb: (version: string) => void): (() => void) => {
    const listener = (_e: unknown, version: string): void => cb(version)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  },

  openRouter: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('router:open'),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:openExternal', url),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setTheme: (mode: ThemeMode): Promise<boolean> => ipcRenderer.invoke('settings:setTheme', mode),
  setAutoUpdate: (value: boolean): Promise<boolean> =>
    ipcRenderer.invoke('settings:setAutoUpdate', value),
  setRouterPassword: (value: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setPassword', value),
}

export type NetworkDoctorApi = typeof api

contextBridge.exposeInMainWorld('api', api)
