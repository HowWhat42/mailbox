import { BrowserWindow, screen } from 'electron'
import { getSettings } from './settings'
import { loadPage, PRELOAD } from './windows'

const WIDTH = 392
const CARD = 132
const GAP = 10
const MARGIN = 16
const MAX_CARDS = 4

let win: BrowserWindow | null = null
let shown = 0

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
 * Shows (without stealing focus) or hides the floating reminder stack, at the
 * spot chosen in the settings of the screen the user is working on.
 */
export function showReminderWindow(count: number): void {
  shown = count
  if (count === 0) {
    win?.hide()
    return
  }
  const w = ensure()
  const cards = Math.min(count, MAX_CARDS)
  const height = cards * CARD + (cards - 1) * GAP + MARGIN * 2
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const [v, h] = getSettings().reminderPosition.split('-')
  // "center" alone is the middle of both axes.
  const across = h ?? v
  const x = across === 'left' ? area.x : across === 'right' ? area.x + area.width - WIDTH : area.x + Math.round((area.width - WIDTH) / 2)
  const y = v === 'top' ? area.y : v === 'bottom' ? area.y + area.height - height : area.y + Math.round((area.height - height) / 2)
  w.setBounds({ width: WIDTH, height, x, y })
  const reveal = (): void => {
    if (!w.isVisible()) w.showInactive()
    w.setAlwaysOnTop(true, 'screen-saver')
  }
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', reveal)
  else reveal()
}

/** Moves an open reminder stack to the newly chosen position. */
export function placeReminderWindow(): void {
  if (shown && win && !win.isDestroyed() && win.isVisible()) showReminderWindow(shown)
}
