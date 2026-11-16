import { BrowserWindow, screen } from 'electron'
import { loadPage, PRELOAD } from './windows'

const WIDTH = 392
const CARD = 132
const GAP = 10
const MARGIN = 16
const MAX_CARDS = 4

let win: BrowserWindow | null = null

function ensure(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: WIDTH,
    height: CARD + MARGIN * 2,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })
  // Above everything, fullscreen apps and presentations included.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadPage(win, 'notify')
  win.on('closed', () => {
    win = null
  })
  return win
}

/**
 * Shows (without stealing focus) or hides the floating reminder stack in the
 * bottom-right corner of the screen the user is working on.
 */
export function showReminderWindow(count: number): void {
  if (count === 0) {
    win?.hide()
    return
  }
  const w = ensure()
  const cards = Math.min(count, MAX_CARDS)
  const height = cards * CARD + (cards - 1) * GAP + MARGIN * 2
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  w.setBounds({ width: WIDTH, height, x: area.x + area.width - WIDTH, y: area.y + area.height - height })
  const reveal = (): void => {
    if (!w.isVisible()) w.showInactive()
    w.setAlwaysOnTop(true, 'screen-saver')
  }
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', reveal)
  else reveal()
}
