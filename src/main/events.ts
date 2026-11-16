import { BrowserWindow } from 'electron'
import type { AppEvents } from '@shared/types'

export function emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(`event:${event}`, payload)
  }
}
