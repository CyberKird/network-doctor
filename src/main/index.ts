import { join } from 'node:path'
import { app, BrowserWindow, clipboard, ipcMain, nativeTheme, shell } from 'electron'
import type {
  AdapterActionResult,
  AdapterView,
  AppSettings,
  PlatformInfo,
  ThemeMode,
  ToolRunResult,
  UpdateState,
} from '../shared/types'
import {
  boostScript,
  listAdapters,
  readBoostPlan,
  revertScript,
  runElevatedPs,
  toggleScript,
} from './net/adapters'
import { TOOLS, forgetRoute, gatewayAddress, platform, toolsForThisPlatform } from './net/capabilities'
import { quickCheck, runDiagnostics } from './net/diagnostics'
import { benchmarkDns } from './net/dnsbench'
import { isIpAddress, run, runElevated } from './net/exec'
import { measureDownload } from './net/speedtest'
import * as store from './store'

let mainWindow: BrowserWindow | null = null
let speedAbort: AbortController | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 660,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'default',
    // Packaged builds take their icon from electron-builder; this is what the
    // window and taskbar use when running from source, and on Linux where the
    // icon is not baked into the binary.
    icon: join(__dirname, '../../build/icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#22252a' : '#eeece7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer is UI only - every privileged action goes through an IPC
      // handler below, so it never needs Node or direct filesystem reach.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Painting only once the renderer is ready avoids the white flash that makes
  // a launch feel slow even when it isn't.
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Elevation cannot change while the process runs, so the probe runs once. */
let adminProbe: Promise<boolean> | null = null

function isAdmin(): Promise<boolean> {
  adminProbe ??= (async () => {
    if (platform === 'win32') {
      // `net session` needs elevation; its exit code is the cheapest probe.
      const { ok } = await run('net session', 5000)
      return ok
    }
    return typeof process.getuid === 'function' && process.getuid() === 0
  })()
  return adminProbe
}

function applyTheme(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
}

/** Adapter names the renderer was last shown. Actions only accept those. */
let knownAdapters = new Set<string>()

/** Shared guard + outcome wording for the adapter handlers. */
async function adapterAction(
  name: unknown,
  work: (name: string) => Promise<{ ok: boolean; declined: boolean; done: string }>,
): Promise<AdapterActionResult> {
  if (platform !== 'win32') return { ok: false, message: 'Disponibil doar pe Windows' }
  if (typeof name !== 'string' || !knownAdapters.has(name)) {
    return { ok: false, message: 'Adaptor necunoscut' }
  }
  try {
    const r = await work(name)
    forgetRoute()
    if (r.ok) return { ok: true, message: r.done }
    return { ok: false, message: r.declined ? 'Anulat - nu ai confirmat cererea de administrator' : 'Nu a mers - încearcă din nou' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

function registerIpc(): void {
  ipcMain.handle('platform:info', async (): Promise<PlatformInfo> => ({
    platform,
    version: app.getVersion(),
    isAdmin: await isAdmin(),
  }))

  ipcMain.handle('diagnostics:run', () => runDiagnostics())
  ipcMain.handle('network:gateway', () => gatewayAddress())
  ipcMain.handle('network:quick', (_e, fresh: unknown) => quickCheck(fresh === true))
  ipcMain.handle('dns:benchmark', () => benchmarkDns())
  ipcMain.handle('tools:list', () => toolsForThisPlatform())

  ipcMain.handle('tools:run', async (_e, id: unknown): Promise<ToolRunResult> => {
    if (typeof id !== 'string') return { ok: false, message: 'Unealtă necunoscută' }
    const spec = TOOLS.find((t) => t.id === id)
    if (!spec) return { ok: false, message: 'Unealtă necunoscută' }

    const entry = spec.perPlatform[platform]
    if ('unsupported' in entry) return { ok: false, message: entry.unsupported }

    try {
      const command = await entry.build()
      const result = entry.elevated ? await runElevated(command) : await run(command)
      // Repairs can change the interface or gateway, so the cached route is stale.
      forgetRoute()
      return result.ok
        ? { ok: true, message: `${spec.label} - gata` }
        : {
            ok: false,
            message: (result.stderr || result.stdout).trim().slice(0, 400) || 'Comanda a eșuat',
          }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  // Adapter control is Windows-only: the list comes from the NetAdapter
  // module, and the driver settings it edits have no counterpart elsewhere.
  ipcMain.handle('adapters:list', async (): Promise<AdapterView[]> => {
    if (platform !== 'win32') return []
    const boosted = new Set(store.getBoostedAdapters())
    const adapters = await listAdapters()
    knownAdapters = new Set(adapters.map((a) => a.name))
    return adapters.map((a) => ({ ...a, boosted: boosted.has(a.name) }))
  })

  ipcMain.handle(
    'adapters:toggle',
    (_e, name: unknown, enable: unknown): Promise<AdapterActionResult> =>
      adapterAction(name, async (n) => {
        const on = Boolean(enable)
        const r = await runElevatedPs(toggleScript(n, on))
        return { ...r, done: on ? `${n} activat` : `${n} dezactivat` }
      }),
  )

  ipcMain.handle(
    'adapters:boost',
    (_e, name: unknown): Promise<AdapterActionResult> =>
      adapterAction(name, async (n) => {
        const plan = await readBoostPlan(n)
        const r = await runElevatedPs(boostScript(n, plan))
        if (r.ok) store.setBoost(n, plan.map((c) => [c.setting, c.from]))
        return { ...r, done: `Boost aplicat pe ${n}` }
      }),
  )

  ipcMain.handle(
    'adapters:revert',
    (_e, name: unknown): Promise<AdapterActionResult> =>
      adapterAction(name, async (n) => {
        const saved = store.getBoost(n)
        if (!saved) return { ok: false, declined: false, code: null, done: '' }
        const r = await runElevatedPs(revertScript(n, saved))
        if (r.ok) store.setBoost(n, undefined)
        return { ...r, done: `Setările inițiale ale ${n} au fost restaurate` }
      }),
  )

  // Resolves to the measured Mb/s, or null when the user stopped it. Cancelling
  // is a normal outcome, so it must not surface as a rejected invoke that the
  // renderer would have to tell apart from a real failure by reading text.
  ipcMain.handle('speed:start', async (event): Promise<number | null> => {
    speedAbort?.abort()
    const controller = new AbortController()
    speedAbort = controller
    try {
      return await measureDownload(
        (p) => event.sender.send('speed:progress', p),
        controller.signal,
      )
    } catch (err) {
      if (controller.signal.aborted) return null
      throw err
    } finally {
      if (speedAbort === controller) speedAbort = null
    }
  })

  ipcMain.handle('update:state', (): UpdateState => updateState)
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:download', async () => {
    if (updateState.status !== 'available') return
    try {
      setUpdateState({ status: 'downloading', version: updateState.version, percent: 0 })
      await (await getUpdater()).downloadUpdate()
    } catch {
      /* reported through the updater's error event */
    }
  })
  ipcMain.handle('update:install', async () => {
    if (updateState.status === 'ready') (await getUpdater()).quitAndInstall(false, true)
  })

  ipcMain.handle('speed:cancel', () => {
    speedAbort?.abort()
    speedAbort = null
  })

  ipcMain.handle('router:open', async () => {
    const gateway = await gatewayAddress()
    if (!gateway || !isIpAddress(gateway)) {
      return { ok: false, message: 'Nu am găsit adresa routerului' }
    }
    const password = store.getRouterPassword()
    if (password) clipboard.writeText(password)
    await shell.openExternal(`http://${gateway}`)
    return {
      ok: true,
      message: password
        ? `Am deschis ${gateway} și am copiat parola`
        : `Am deschis ${gateway}`,
    }
  })

  ipcMain.handle('settings:get', (): AppSettings => ({
    theme: store.getTheme(),
    motion: store.getMotion(),
    autoUpdate: store.getAutoUpdate(),
    hasRouterPassword: store.hasRouterPassword(),
  }))

  ipcMain.handle('settings:setMotion', (_e, mode: unknown) => {
    if (mode !== 'system' && mode !== 'on' && mode !== 'off') return false
    store.setMotion(mode)
    return true
  })

  ipcMain.handle('settings:setTheme', (_e, mode: unknown) => {
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return false
    store.setTheme(mode)
    applyTheme(mode)
    return true
  })

  ipcMain.handle('settings:setAutoUpdate', (_e, value: unknown) => {
    store.setAutoUpdate(Boolean(value))
    return true
  })

  ipcMain.handle('settings:setPassword', (_e, value: unknown) => {
    if (typeof value !== 'string') return { ok: false, error: 'Parolă invalidă' }
    return store.setRouterPassword(value)
  })

  // Decrypting is deliberately its own call rather than part of settings:get,
  // so the password only crosses into the renderer when the user asks to see
  // it - not on every settings read.
  ipcMain.handle('settings:revealPassword', (): string | null => store.getRouterPassword())

  ipcMain.handle('shell:openExternal', (_e, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return false
    shell.openExternal(url)
    return true
  })
}

/**
 * In-app updates, from the project's GitHub releases.
 *
 * electron-updater is loaded on first use rather than at startup - it pulls in
 * a good deal of code that the first paint does not need. It only works in a
 * packaged build (a dev run has no app-update.yml), and a network failure must
 * never take the app down, so every outcome is reported as state instead of
 * thrown.
 */
type Updater = (typeof import('electron-updater'))['autoUpdater']
let updaterPromise: Promise<Updater> | null = null
let updateState: UpdateState = { status: 'idle' }

function setUpdateState(next: UpdateState): void {
  updateState = next
  mainWindow?.webContents.send('update:state', next)
}

function getUpdater(): Promise<Updater> {
  updaterPromise ??= import('electron-updater').then((mod) => {
    const autoUpdater = (mod.default ?? mod).autoUpdater
    // The user decides when to download and when to restart.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking' }))
    autoUpdater.on('update-available', (info) =>
      setUpdateState({ status: 'available', version: info.version }),
    )
    autoUpdater.on('update-not-available', () => setUpdateState({ status: 'none' }))
    autoUpdater.on('download-progress', (p) => {
      if (updateState.status === 'downloading') {
        setUpdateState({
          status: 'downloading',
          version: updateState.version,
          percent: Math.round(p.percent),
        })
      }
    })
    autoUpdater.on('update-downloaded', (info) =>
      setUpdateState({ status: 'ready', version: info.version }),
    )
    autoUpdater.on('error', (err) =>
      setUpdateState({
        status: 'error',
        message: err?.message?.split('\n')[0] ?? 'Actualizarea a eșuat',
      }),
    )
    return autoUpdater
  })
  return updaterPromise
}

async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    setUpdateState({
      status: 'error',
      message: 'Actualizările funcționează doar în versiunea instalată',
    })
    return
  }
  try {
    await (await getUpdater()).checkForUpdates()
  } catch {
    /* already reported through the updater's own error event */
  }
}

app.whenReady().then(() => {
  applyTheme(store.getTheme())
  registerIpc()
  createWindow()
  // Well after first paint, so it never competes with startup.
  if (app.isPackaged && store.getAutoUpdate()) setTimeout(() => void checkForUpdates(), 4000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS convention keeps the app alive without windows; the other two do not.
  if (platform !== 'darwin') app.quit()
})
