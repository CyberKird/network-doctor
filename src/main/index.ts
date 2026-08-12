import { join } from 'node:path'
import { app, BrowserWindow, clipboard, ipcMain, nativeTheme, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppSettings, PlatformInfo, ThemeMode, ToolRunResult } from '../shared/types'
import { TOOLS, gatewayAddress, platform, toolsForThisPlatform } from './net/capabilities'
import { runDiagnostics } from './net/diagnostics'
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

async function isAdmin(): Promise<boolean> {
  if (platform === 'win32') {
    // `net session` needs elevation; its exit code is the cheapest probe.
    const { ok } = await run('net session', 5000)
    return ok
  }
  return typeof process.getuid === 'function' && process.getuid() === 0
}

function applyTheme(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
}

function registerIpc(): void {
  ipcMain.handle('platform:info', async (): Promise<PlatformInfo> => ({
    platform,
    version: app.getVersion(),
    isAdmin: await isAdmin(),
  }))

  ipcMain.handle('diagnostics:run', () => runDiagnostics())
  ipcMain.handle('network:gateway', () => gatewayAddress())
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
 * Update check against the project's GitHub releases.
 *
 * Only meaningful in a packaged build - a dev run has no app-update.yml, and
 * a network failure here must never be allowed to take the app down with it.
 */
function checkForUpdates(): void {
  if (!app.isPackaged || !store.getAutoUpdate()) return
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = false
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', info.version)
  })
  autoUpdater.on('error', () => {
    /* offline, rate-limited, or no release yet - not worth interrupting for */
  })
  void autoUpdater.checkForUpdates()
}

app.whenReady().then(() => {
  applyTheme(store.getTheme())
  registerIpc()
  createWindow()
  checkForUpdates()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS convention keeps the app alive without windows; the other two do not.
  if (platform !== 'darwin') app.quit()
})
