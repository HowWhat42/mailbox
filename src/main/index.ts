import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { getDb } from './db'
import { registerIpc } from './ipc'
import { startWatching, stopWatching } from './mail/watch'

const TITLEBAR = {
  dark: { color: '#0c0c0e', symbolColor: '#8b8b94' },
  light: { color: '#fbfbfc', symbolColor: '#5c5c66' }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: TITLEBAR.dark.color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLEBAR.dark, height: 40 },
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  win.once('ready-to-show', () => win.show())

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

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  app.setAppUserModelId('app.mailbox.desktop')
  nativeTheme.themeSource = 'dark'
  getDb()
  registerIpc()
  ipcMain.handle('app:setTheme', (event, theme: 'dark' | 'light') => {
    nativeTheme.themeSource = theme
    const win = BrowserWindow.fromWebContents(event.sender)
    if (process.platform !== 'darwin') win?.setTitleBarOverlay({ ...TITLEBAR[theme], height: 40 })
    win?.setBackgroundColor(TITLEBAR[theme].color)
  })
  createWindow()
  startWatching()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => stopWatching())
