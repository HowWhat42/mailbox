import { BrowserWindow, screen, type Rectangle } from 'electron'
import { getSettings } from './settings'
import { loadPage, PRELOAD } from './windows'

const WIDTH = 412
const CARD = 132
const GAP = 10
const MARGIN = 16
const MAX_CARDS = 4

let win: BrowserWindow | null = null
let shown = 0
/** Where the user dragged the stack, kept until it closes; `bottom` anchors growth upward. */
let dragged: { x: number; top: number; bottom: number } | null = null
let placed: Rectangle | null = null

function ensure(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: WIDTH,
    height: CARD + MARGIN * 2,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
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
  win.on('moved', () => {
    if (!win) return
    const b = win.getBounds()
    // Our own setBounds can also fire "moved": only a real drag changes the spot.
    if (placed && b.x === placed.x && b.y === placed.y) return
    dragged = { x: b.x, top: b.y, bottom: b.y + b.height }
  })
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
    dragged = null
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
  // Once dragged, stay there: grow from the edge the cards hug.
  const bounds = dragged
    ? { width: WIDTH, height, x: dragged.x, y: v === 'top' ? dragged.top : dragged.bottom - height }
    : { width: WIDTH, height, x, y }
  placed = bounds
  w.setBounds(bounds)
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
