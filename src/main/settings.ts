import { app } from 'electron'
import type { AppSettings } from '@shared/types'
import { getDb } from './db'
import { emit } from './events'

export const DEFAULT_SETTINGS: AppSettings = {
  backgroundMode: true,
  launchAtLogin: false,
  startHidden: true,
  markReadDelay: 0,
  undoSeconds: 5,
  remoteImages: 'block',

  theme: 'dark',
  uiScale: 0,
  accent: '#8f86f0',
  backdrop: 'nebula',
  density: 'comfortable',

  mailNotifications: true,
  smartNotifications: true,
  mailSound: true,
  quietHours: false,
  quietStart: 22 * 60,
  quietEnd: 8 * 60,
  reminderMinutes: 10,
  reminderSound: true,
  reminderAtStart: true,

  smartInbox: true,
  categories: ['people', 'notifications', 'newsletters', 'invitations']
}

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored = Object.fromEntries(rows.filter((r) => r.key in DEFAULT_SETTINGS).map((r) => [r.key, JSON.parse(r.value)]))
  return { ...DEFAULT_SETTINGS, ...stored }
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const upsert = getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
  for (const [key, value] of Object.entries(patch)) {
    if (key in DEFAULT_SETTINGS && value !== undefined) upsert.run(key, JSON.stringify(value))
  }
  const next = getSettings()
  if ('launchAtLogin' in patch || 'startHidden' in patch) applyLoginItem()
  if ('uiScale' in patch) onScaleChange?.()
  emit('settings:changed', next)
  return next
}

let onScaleChange: (() => void) | null = null
/** Lets the window module react to the zoom setting without an import cycle. */
export function onUiScaleChange(fn: () => void): void {
  onScaleChange = fn
}

/** Is `now` inside the user's quiet hours (which may wrap past midnight)? */
export function inQuietHours(now = new Date()): boolean {
  const s = getSettings()
  if (!s.quietHours) return false
  const m = now.getHours() * 60 + now.getMinutes()
  return s.quietStart <= s.quietEnd ? m >= s.quietStart && m < s.quietEnd : m >= s.quietStart || m < s.quietEnd
}

/**
 * Registers Mailbox to start with the OS session. The installed app registers itself;
 * a dev build registers Electron with the project path so the option works there too.
 */
function loginItemTarget(): { path: string; args: string[] } {
  const hidden = getSettings().startHidden ? ['--hidden'] : []
  return app.isPackaged ? { path: process.execPath, args: hidden } : { path: process.execPath, args: [app.getAppPath(), ...hidden] }
}

export function applyLoginItem(): void {
  const target = loginItemTarget()
  // Clear both variants so toggling "start hidden" doesn't leave a stale entry behind.
  for (const args of [target.args.filter((a) => a !== '--hidden'), [...target.args.filter((a) => a !== '--hidden'), '--hidden']]) {
    app.setLoginItemSettings({ openAtLogin: false, path: target.path, args })
  }
  if (getSettings().launchAtLogin) app.setLoginItemSettings({ openAtLogin: true, path: target.path, args: target.args })
}

export function loginItemStatus(): { enabled: boolean; packaged: boolean } {
  const target = loginItemTarget()
  return { enabled: app.getLoginItemSettings(target).openAtLogin, packaged: app.isPackaged }
}
