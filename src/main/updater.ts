import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { emit } from './events'
import { isOffline } from './mail/queue'

const CHECK_EVERY = 4 * 60 * 60_000
const FIRST_CHECK_AFTER = 15_000

let status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'unsupported', current: app.getVersion() }

function set(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next }
  emit('update:status', status)
}

/**
 * Releases come from GitHub (see `build.publish`): checked at start-up and every few hours,
 * downloaded in the background, installed on restart or on the next quit.
 * A dev build only updates when pointed at a feed with MAILBOX_UPDATE_FEED (e2e tests).
 */
export function startUpdater(): void {
  const feed = app.isPackaged ? undefined : process.env.MAILBOX_UPDATE_FEED
  if (!app.isPackaged && !feed) return
  if (feed) {
    // Same shape as the app-update.yml electron-builder bundles, pointing at the test feed.
    const config = join(app.getPath('userData'), 'dev-app-update.yml')
    writeFileSync(config, ['provider: generic', `url: ${JSON.stringify(feed)}`, 'updaterCacheDirName: mailbox-updater-test', ''].join('\n'))
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.updateConfigPath = config
    set({ state: 'idle' })
  }
  autoUpdater.logger = null
  // Downloaded by hand so a failed download lands in our status, not in an unhandled rejection.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => set({ state: 'latest', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) => {
    set({ state: 'downloading', available: info.version, percent: 0, checkedAt: Date.now() })
    autoUpdater.downloadUpdate().catch((err: unknown) => set({ state: 'error', error: describe(err) }))
  })
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', available: info.version, percent: 100 }))
  autoUpdater.on('error', (err) => set({ state: 'error', error: describe(err) }))

  setTimeout(() => void checkForUpdates(), feed ? 0 : FIRST_CHECK_AFTER)
  setInterval(() => void checkForUpdates(), CHECK_EVERY)
}

function describe(err: unknown): string {
  if (!app.isPackaged) console.error('[updater]', err)
  if (isOffline(err)) return 'Hors ligne : nouvel essai plus tard.'
  return 'La recherche de mise à jour a échoué.'
}

export function updateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  // Nothing to do in dev, and no second download over one in progress or ready.
  if (status.state === 'unsupported' || status.state === 'downloading' || status.state === 'ready') return status
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', error: describe(err) })
  }
  return status
}

/** Quits, runs the downloaded installer silently and relaunches Mailbox. */
export function installUpdate(): void {
  if (status.state !== 'ready') return
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
