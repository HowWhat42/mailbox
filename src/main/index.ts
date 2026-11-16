import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { getDb } from './db'
import { registerIpc } from './ipc'
import { applyLoginItem, getSettings, onUiScaleChange } from './settings'
import { startWatching, stopWatching } from './mail/watch'
import { startCalendarSync, stopCalendarSync } from './calendar'
import { syncAccountSources } from './calendar/sources'
import { startReminders, stopReminders } from './calendar/reminders'
import { applyZoom, createMainWindow, showMainWindow, TITLEBAR } from './windows'
import { createTray } from './tray'

if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', () => showMainWindow())

app.whenReady().then(() => {
  app.setAppUserModelId('app.mailbox.desktop')
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
