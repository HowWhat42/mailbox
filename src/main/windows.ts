import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, screen, shell } from 'electron'
import { getSettings } from './settings'

export const TITLEBAR = {
  dark: { color: '#000000', symbolColor: '#cdc8e4' },
  light: { color: '#e9e8f2', symbolColor: '#3c3950' }
}

let main: BrowserWindow | null = null
let quitting = false

app.on('before-quit', () => {
  quitting = true
})

export const PRELOAD = join(__dirname, '../preload/index.js')

/** Loads one of the renderer pages (dev server or built files). */
export function loadPage(win: BrowserWindow, page: 'index' | 'notify'): void {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

/** App icon (.ico on Windows, sharper in the taskbar) or tray icon (tray@2x.png is picked up on HiDPI). */
export function iconPath(name: 'icon' | 'tray'): string {
  const ext = name === 'icon' && process.platform === 'win32' ? 'ico' : 'png'
  return join(__dirname, `../../resources/${name}.${ext}`)
}

export function createMainWindow({ hidden }: { hidden: boolean }): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 480,
    minHeight: 520,
    show: false,
    icon: iconPath('icon'),
    backgroundColor: dark ? TITLEBAR.dark.color : TITLEBAR.light.color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLEBAR.dark, height: 48 },
    trafficLightPosition: { x: 14, y: 17 },
    // Countdowns, toasts and "next up" must keep ticking while the window is in the background.
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, backgroundThrottling: false }
  })
  if (!hidden) win.once('ready-to-show', () => win.show())

  // Links (including those clicked inside message bodies) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    }
  })
  // In background mode, closing only hides: reminders keep working from the tray.
  win.on('close', (event) => {
    if (!quitting && getSettings().backgroundMode) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (main === win) main = null
    // The hidden reminder window must not keep the app alive once the user closed it for real.
    if (!getSettings().backgroundMode) app.quit()
  })

  // Re-evaluate the automatic zoom when the window lands on another screen.
  win.webContents.on('did-finish-load', () => applyZoom(win))
  win.on('moved', () => applyZoom(win))
  win.on('resize', () => applyZoom(win))

  loadPage(win, 'index')
  main = win
  return win
}

/**
 * Interface zoom: the user's choice, or automatic from the width of the screen the window
 * is on, so a 2560px+ monitor doesn't get a postage-stamp UI.
 */
export function zoomFor(win: BrowserWindow): number {
  const chosen = getSettings().uiScale
  if (chosen > 0) return chosen
  const width = screen.getDisplayMatching(win.getBounds()).workAreaSize.width
  return width >= 3400 ? 1.35 : width >= 2400 ? 1.2 : width >= 1900 ? 1.05 : 1
}

export function applyZoom(win: BrowserWindow | null = getMainWindow()): void {
  if (!win || win.isDestroyed()) return
  const factor = zoomFor(win)
  if (Math.abs(win.webContents.getZoomFactor() - factor) > 0.001) win.webContents.setZoomFactor(factor)
}

export function getMainWindow(): BrowserWindow | null {
  return main && !main.isDestroyed() ? main : null
}

export function showMainWindow(): void {
  const win = getMainWindow() ?? createMainWindow({ hidden: false })
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
