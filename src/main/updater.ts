import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Notification, app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import type { ReleaseNote, UpdateStatus } from '@shared/types'
import { emit } from './events'
import { isOffline } from './mail/queue'
import { showMainWindow } from './windows'

const CHECK_EVERY = 15 * 60_000
const FIRST_CHECK_AFTER = 15_000

// The Mac build is not signed, and macOS only installs updates of a signed app; electron-updater
// cannot update a snap or a flatpak. There the new version is announced and downloaded from its
// release page. On Linux it is found through the GitHub API: the release carries no Linux update feed.
const LINUX = process.platform === 'linux'
const MANUAL = process.platform === 'darwin' || LINUX
const RELEASES = 'https://github.com/HowWhat42/mailbox/releases'
const RELEASES_API = 'https://api.github.com/repos/HowWhat42/mailbox/releases?per_page=30'

let status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'unsupported', current: app.getVersion(), manual: MANUAL }

function set(next: Partial<UpdateStatus>): void {
  const was = status.state
  status = { ...status, ...next }
  emit('update:status', status)
  if (status.state === 'ready' && was !== 'ready') announce()
}

/** One system notification when a version is ready: the sidebar card is easy to miss. Clicking it shows what's new. */
function announce(): void {
  if (!app.isPackaged || !Notification.isSupported()) return
  const n = new Notification({
    title: `Mailbox ${status.available} est disponible`,
    body: status.manual
      ? 'Cliquez pour voir les nouveautés et la télécharger.'
      : 'Cliquez pour voir les nouveautés. Elle s’installera au prochain redémarrage.'
  })
  n.on('click', () => {
    showMainWindow()
    emit('update:notes', {})
  })
  n.show()
}

/**
 * Releases come from GitHub (see `build.publish`): checked at start-up and every 15 minutes,
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
  } else if (LINUX) {
    setTimeout(() => void checkForUpdates(), FIRST_CHECK_AFTER)
    setInterval(() => void checkForUpdates(), CHECK_EVERY)
    return
  }
  autoUpdater.logger = null
  // Every version between this one and the latest, not just the latest: a few releases behind, all their notes count.
  autoUpdater.fullChangelog = true
  // Downloaded by hand so a failed download lands in our status, not in an unhandled rejection.
  autoUpdater.autoDownload = false
  // A test feed must never install anything: on quit, the downloaded test build would replace the
  // Mailbox installed on the machine (it once did, leaving a 9.9.9 that no real release could update).
  autoUpdater.autoInstallOnAppQuit = !feed && !MANUAL

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => set({ state: 'latest', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) => {
    if (MANUAL) return set({ state: 'ready', available: info.version, checkedAt: Date.now(), notes: notesOf(info) })
    set({ state: 'downloading', available: info.version, percent: 0, checkedAt: Date.now(), notes: notesOf(info) })
    autoUpdater.downloadUpdate().catch((err: unknown) => set({ state: 'error', error: describe(err) }))
  })
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', available: info.version, percent: 100, notes: notesOf(info) }))
  autoUpdater.on('error', (err) => set({ state: 'error', error: describe(err) }))

  setTimeout(() => void checkForUpdates(), feed ? 0 : FIRST_CHECK_AFTER)
  setInterval(() => void checkForUpdates(), CHECK_EVERY)
}

/** Release notes per version, newest first: GitHub gives one per release since this one, a plain feed one text. */
function notesOf(info: UpdateInfo): ReleaseNote[] | null {
  const n = info.releaseNotes
  if (!n) return null
  if (typeof n === 'string') return [{ version: info.version, note: n }]
  const notes = n.filter((v) => v.note).map((v) => ({ version: v.version, note: v.note! }))
  return notes.length ? notes : null
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
  if (LINUX && app.isPackaged) return checkLatestRelease()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', error: describe(err) })
  }
  return status
}

/** Linux: compares the published GitHub Releases with this version, keeping the notes of every newer one. */
async function checkLatestRelease(): Promise<UpdateStatus> {
  set({ state: 'checking', error: undefined })
  try {
    // The html variant adds `body_html`: the rendered notes, as electron-updater reads them elsewhere.
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github.html+json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const releases = (await res.json()) as { tag_name: string; draft: boolean; prerelease: boolean; body_html?: string | null }[]
    const newer = releases
      .filter((r) => !r.draft && !r.prerelease)
      .map((r) => ({ version: r.tag_name.replace(/^v/, ''), note: r.body_html ?? '' }))
      .filter((r) => isNewer(r.version, app.getVersion()))
      .toSorted((a, b) => (isNewer(a.version, b.version) ? -1 : 1))
    if (newer.length) {
      const notes = newer.filter((r) => r.note)
      set({ state: 'ready', available: newer[0].version, checkedAt: Date.now(), notes: notes.length ? notes : null })
    } else set({ state: 'latest', checkedAt: Date.now() })
  } catch (err) {
    set({ state: 'error', error: describe(err) })
  }
  return status
}

/** True when version `a` (X.Y.Z) is later than `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

/** Quits, runs the downloaded installer silently and relaunches Mailbox. */
export function installUpdate(): void {
  if (status.state !== 'ready' || !app.isPackaged) return
  if (MANUAL) return void shell.openExternal(`${RELEASES}/tag/v${status.available}`)
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
