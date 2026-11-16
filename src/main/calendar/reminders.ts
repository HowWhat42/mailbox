import { shell } from 'electron'
import type { Reminder, ResponseStatus } from '@shared/types'
import { getDb } from '../db'
import { emit } from '../events'
import { getSettings } from '../settings'
import { showReminderWindow } from '../notifyWindow'
import { showMainWindow } from '../windows'

const TICK = 15_000
/** A reminder still pops up this long after the event started (late joiners, app just opened). */
const GRACE = 5 * 60_000

interface DueRow {
  id: string
  title: string
  start: number
  end: number
  all_day: number
  location: string
  meeting_url: string | null
  meeting_provider: string | null
  reminders_json: string | null
  default_reminders: string
  reminder_override: number | null
  my_status: ResponseStatus | null
  color: string
  calendar_name: string
}

const active = new Map<string, Reminder>()
const snoozed = new Map<string, { until: number; reminder: Reminder }>()
let timer: NodeJS.Timeout | null = null

export function activeReminders(): Reminder[] {
  return [...active.values()].toSorted((a, b) => a.start - b.start)
}

function publish(): void {
  showReminderWindow(activeReminders().length)
  emit('reminders:changed', {})
}

function show(reminder: Reminder): void {
  // One card per event: a later reminder for the same event replaces the earlier one.
  for (const [key, r] of active) if (r.eventId === reminder.eventId) active.delete(key)
  active.set(reminder.key, reminder)
}

function tick(): void {
  const now = Date.now()
  const db = getDb()
  const { reminderMinutes, reminderAtStart } = getSettings()
  const rows = db
    .prepare(
      `SELECT e.id, e.title, e.start, e.end, e.all_day, e.location, e.meeting_url, e.meeting_provider, e.reminders_json,
              e.my_status, c.default_reminders, c.reminder_override, coalesce(c.user_color, c.color) AS color, c.name AS calendar_name
       FROM events e JOIN calendars c ON c.id = e.calendar_id
       WHERE c.enabled = 1 AND c.notify = 1 AND e.all_day = 0 AND e.status <> 'cancelled'
         AND coalesce(e.my_status, '') <> 'declined' AND e.start > ? AND e.start < ?`
    )
    .all(now - GRACE, now + 24 * 3_600_000) as unknown as DueRow[]

  const fired = db.prepare('SELECT 1 FROM reminders_fired WHERE key = ?')
  const markFired = db.prepare('INSERT OR IGNORE INTO reminders_fired (key, fired_at) VALUES (?, ?)')
  let changed = false

  for (const row of rows) {
    // A per-calendar override beats the event's alarms, which beat the global default.
    const own = row.reminder_override != null ? [row.reminder_override] : (JSON.parse(row.reminders_json ?? row.default_reminders) as number[])
    const offsets = new Set(own.length ? own : [reminderMinutes])
    // Online meetings also ping when they start: that's when you need the Join button.
    if (row.meeting_url && reminderAtStart) offsets.add(0)
    for (const minutes of offsets) {
      const key = `${row.id}:${row.start}:${minutes}`
      if (now < row.start - minutes * 60_000 || fired.get(key) || snoozed.has(key)) continue
      markFired.run(key, now)
      show({
        key,
        eventId: row.id,
        title: row.title || '(sans titre)',
        start: row.start,
        end: row.end,
        allDay: !!row.all_day,
        location: row.location,
        meetingUrl: row.meeting_url,
        meetingProvider: row.meeting_provider,
        color: row.color,
        calendarName: row.calendar_name
      })
      changed = true
    }
  }

  for (const [key, s] of snoozed) {
    if (now >= s.until) {
      snoozed.delete(key)
      show(s.reminder)
      changed = true
    }
  }
  // Cards for meetings that are over go away on their own.
  for (const [key, r] of active) {
    if (r.end < now) {
      active.delete(key)
      changed = true
    }
  }
  if (changed) publish()
}

export function startReminders(): void {
  getDb()
    .prepare('DELETE FROM reminders_fired WHERE fired_at < ?')
    .run(Date.now() - 14 * 86_400_000)
  tick()
  timer ??= setInterval(tick, TICK)
}

/** Re-check right away (after a calendar refresh). */
export function checkReminders(): void {
  if (timer) tick()
}

export function stopReminders(): void {
  if (timer) clearInterval(timer)
  timer = null
}

function take(key: string): Reminder | undefined {
  const r = active.get(key)
  active.delete(key)
  publish()
  return r
}

export function dismissReminder(key: string): void {
  take(key)
}

export function snoozeReminder(key: string, minutes: number): void {
  const r = take(key)
  if (r) snoozed.set(key, { until: Date.now() + minutes * 60_000, reminder: r })
}

export async function joinReminder(key: string): Promise<void> {
  const r = take(key)
  if (r?.meetingUrl && /^https:\/\//i.test(r.meetingUrl)) await shell.openExternal(r.meetingUrl)
}

export function openReminder(key: string): void {
  const r = take(key)
  if (!r) return
  showMainWindow()
  emit('calendar:open', { eventId: r.eventId, start: r.start })
}
