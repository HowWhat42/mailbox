import { join } from 'node:path'
import { app } from 'electron'

/**
 * The installed app and a dev run live side by side on the same machine. They get distinct
 * identities so they never share a database, a single-instance lock, a "start with Windows"
 * entry (keyed on this id) or a taskbar group.
 */
export const APP_ID = app.isPackaged ? 'app.mailbox.desktop' : 'app.mailbox.desktop.dev'

/** Dev runs keep their data in "Mailbox Dev", unless a --user-data-dir is given (the e2e tests). */
export function isolateDevData(): void {
  if (app.isPackaged || app.commandLine.hasSwitch('user-data-dir')) return
  app.setPath('userData', join(app.getPath('appData'), 'Mailbox Dev'))
}
