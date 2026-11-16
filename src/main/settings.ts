import { app } from 'electron'
import type { AppSettings } from '@shared/types'
import { getDb } from './db'

const DEFAULTS: AppSettings = {
  backgroundMode: true,
  launchAtLogin: false,
  reminderMinutes: 10,
  reminderSound: true
}

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
  return { ...DEFAULTS, ...stored }
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const upsert = getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
  for (const [key, value] of Object.entries(patch)) {
    if (key in DEFAULTS && value !== undefined) upsert.run(key, JSON.stringify(value))
  }
  return getSettings()
}

/** Start with the session (straight to the tray). Only meaningful for the installed app, not `npm run dev`. */
export function applyLoginItem(): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: getSettings().launchAtLogin, args: ['--hidden'] })
}
