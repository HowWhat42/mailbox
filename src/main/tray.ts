import { app, Menu, nativeImage, Tray } from 'electron'
import { emit } from './events'
import { iconPath, showMainWindow } from './windows'

let tray: Tray | null = null

/** Tray icon: the app stays reachable (and reminders keep firing) with the window closed. */
export function createTray(): void {
  if (tray) return
  let image = nativeImage.createFromPath(iconPath('tray'))
  // The macOS menu bar is about 22 pt tall: the 32 px Windows icon would overflow it.
  if (process.platform === 'darwin' && !image.isEmpty()) image = image.resize({ width: 18, height: 18, quality: 'best' })
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('Mailbox')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir Mailbox', click: () => showMainWindow() },
      {
        label: 'Ouvrir le calendrier',
        click: () => {
          showMainWindow()
          emit('calendar:open', { eventId: '', start: Date.now() })
        }
      },
      { type: 'separator' },
      { label: 'Quitter', click: () => app.quit() }
    ])
  )
  tray.on('click', () => showMainWindow())
}
