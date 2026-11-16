import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { getDb } from './db'
import { registerIpc } from './ipc'
import { applyLoginItem, getSettings, onUiScaleChange } from './settings'
import { startWatching, stopWatching } from './mail/watch'
import { startCalendarSync, stopCalendarSync } from './calendar'
import { syncAccountSources } from './calendar/sources'
import { startReminders, stopReminders } from './calendar/reminders'
import { applyZoom, createMainWindow, iconPath, showMainWindow, TITLEBAR } from './windows'
import { createTray } from './tray'

if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', () => showMainWindow())

const APP_ID = 'app.mailbox.desktop'

/**
 * Windows names the taskbar entry and toasts after the Start Menu shortcut that carries the app's
 * AppUserModelId. The installer creates it; in dev we run electron.exe, so register one ourselves
 * or everything reads "Electron".
 */
function registerDevShortcut(): void {
  if (app.isPackaged || process.platform !== 'win32') return
  const link = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Mailbox (dev).lnk')
  shell.writeShortcutLink(link, existsSync(link) ? 'replace' : 'create', {
    target: process.execPath,
    args: `"${app.getAppPath()}"`,
    appUserModelId: APP_ID,
    icon: iconPath('icon'),
    iconIndex: 0
  })
}

app.whenReady().then(() => {
  registerDevShortcut()
  app.setAppUserModelId(APP_ID)
  nativeTheme.themeSource = 'dark'
  getDb()
  syncAccountSources()
  registerIpc()
  ipcMain.handle('app:setTheme', (event, theme: 'dark' | 'light') => {
    nativeTheme.themeSource = theme
    const win = BrowserWindow.fromWebContents(event.sender)
    if (process.platform !== 'darwin') win?.setTitleBarOverlay({ ...TITLEBAR[theme], height: 48 })
    win?.setBackgroundColor(TITLEBAR[theme].color)
  })
  applyLoginItem()

  onUiScaleChange(() => applyZoom())
  createMainWindow({ hidden: process.argv.includes('--hidden') })
  createTray()
  startWatching()
  startCalendarSync()
  startReminders()
  app.on('activate', () => showMainWindow())
})

app.on('window-all-closed', () => {
  // With background mode on, the main window only hides and this never fires.
  if (!getSettings().backgroundMode) app.quit()
})

app.on('before-quit', () => {
  stopWatching()
  stopCalendarSync()
  stopReminders()
})
