import { createHash } from 'node:crypto'
import type { Account, Calendar, CalendarEvent, EventInput } from '@shared/types'
import { getDb, tx } from '../db'
import { emit } from '../events'
import { getAccount, listAccounts } from '../accounts/store'
import { googleCalendars, googleCreate, googleDelete, googleEvents, googleUpdate } from './google'
import { caldavCalendars, caldavCreate, caldavDelete, caldavEvents, caldavUpdate } from './caldav'
import type { RemoteCalendar, RemoteEvent } from './types'

interface CalendarRow {
  id: string
  account_id: string
  remote_id: string
  name: string
  color: string
  read_only: number
  enabled: number
}

interface EventRow {
  id: string
  calendar_id: string
  account_id: string
  remote_id: string
  etag: string | null
  ical: string | null
  title: string
  location: string
  description: string
  start: number
  end: number
  all_day: number
  recurring: number
}

function hasCalendar(account: Account): boolean {
  return account.kind === 'google' || !!account.caldavUrl
}

function localId(...parts: string[]): string {
  return createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 20)
}

export function listCalendars(): Calendar[] {
  const rows = getDb().prepare('SELECT * FROM calendars ORDER BY name COLLATE NOCASE').all() as unknown as CalendarRow[]
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    color: r.color,
    readOnly: !!r.read_only,
    enabled: !!r.enabled
  }))
}

export function setCalendarEnabled(id: string, enabled: boolean): void {
  getDb().prepare('UPDATE calendars SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

export function listEvents(start: number, end: number): CalendarEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT e.* FROM events e JOIN calendars c ON c.id = e.calendar_id
       WHERE c.enabled = 1 AND e.start < ? AND e.end > ? ORDER BY e.start`
    )
    .all(end, start) as unknown as EventRow[]
  return rows.map((r) => ({
    id: r.id,
    calendarId: r.calendar_id,
    accountId: r.account_id,
    title: r.title,
    location: r.location,
    description: r.description,
    start: r.start,
    end: r.end,
    allDay: !!r.all_day,
    recurring: !!r.recurring
  }))
}

async function fetchCalendars(account: Account): Promise<RemoteCalendar[]> {
  return account.kind === 'google' ? googleCalendars(account) : caldavCalendars(account)
}

async function fetchEvents(account: Account, remoteCalendarId: string, start: number, end: number): Promise<RemoteEvent[]> {
  return account.kind === 'google'
    ? googleEvents(account, remoteCalendarId, start, end)
    : caldavEvents(account, remoteCalendarId, start, end)
}

/** Pulls calendars and the events of [start, end) for every account that has a calendar. */
export async function refreshCalendars(start: number, end: number): Promise<void> {
  const errors: string[] = []
  await Promise.all(
    listAccounts()
      .filter(hasCalendar)
      .map(async (account) => {
        try {
          await refreshAccount(account, start, end)
          emit('calendar:changed', { accountId: account.id })
        } catch (err) {
          errors.push(`${account.email} : ${(err as Error).message}`)
        }
      })
  )
  if (errors.length) throw new Error(errors.join('\n'))
}

async function refreshAccount(account: Account, start: number, end: number): Promise<void> {
  const db = getDb()
  const remote = await fetchCalendars(account)
  tx(() => {
    const upsert = db.prepare(
      `INSERT INTO calendars (id, account_id, remote_id, name, color, read_only) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (account_id, remote_id) DO UPDATE SET name = excluded.name, color = excluded.color, read_only = excluded.read_only`
    )
    for (const c of remote) upsert.run(localId(account.id, c.remoteId), account.id, c.remoteId, c.name, c.color, c.readOnly ? 1 : 0)
    const keep = new Set(remote.map((c) => c.remoteId))
    const local = db.prepare('SELECT id, remote_id FROM calendars WHERE account_id = ?').all(account.id) as { id: string; remote_id: string }[]
    for (const l of local) if (!keep.has(l.remote_id)) db.prepare('DELETE FROM calendars WHERE id = ?').run(l.id)
  })

  const calendars = db.prepare('SELECT * FROM calendars WHERE account_id = ? AND enabled = 1').all(account.id) as unknown as CalendarRow[]
  for (const cal of calendars) {
    const events = await fetchEvents(account, cal.remote_id, start, end)
    tx(() => {
      // Replace the window: anything we had there that the server no longer returns is gone.
      db.prepare('DELETE FROM events WHERE calendar_id = ? AND start < ? AND end > ?').run(cal.id, end, start)
      const insert = db.prepare(
        `INSERT OR REPLACE INTO events (id, calendar_id, account_id, remote_id, etag, ical, title, location, description, start, end, all_day, recurring)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const e of events) {
        insert.run(
          localId(cal.id, e.remoteId),
          cal.id,
          account.id,
          e.remoteId,
          e.etag,
          e.ical,
          e.title,
          e.location,
          e.description,
          e.start,
          e.end,
          e.allDay ? 1 : 0,
          e.recurring ? 1 : 0
        )
      }
    })
  }
}

function calendarRow(id: string): CalendarRow {
  const row = getDb().prepare('SELECT * FROM calendars WHERE id = ?').get(id) as unknown as CalendarRow | undefined
  if (!row) throw new Error('Agenda introuvable.')
  return row
}

function eventRow(id: string): EventRow {
  const row = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id) as unknown as EventRow | undefined
  if (!row) throw new Error('Événement introuvable.')
  return row
}

async function afterWrite(account: Account, around: number): Promise<void> {
  const day = 86_400_000
  await refreshAccount(account, around - 45 * day, around + 45 * day)
  emit('calendar:changed', { accountId: account.id })
}

export async function createEvent(input: EventInput): Promise<void> {
  const cal = calendarRow(input.calendarId)
  if (cal.read_only) throw new Error('Cet agenda est en lecture seule.')
  const account = getAccount(cal.account_id)
  if (account.kind === 'google') await googleCreate(account, cal.remote_id, input)
  else await caldavCreate(account, cal.remote_id, input)
  await afterWrite(account, input.start)
}

export async function updateEvent(id: string, input: EventInput): Promise<void> {
  const ev = eventRow(id)
  const cal = calendarRow(ev.calendar_id)
  if (cal.read_only) throw new Error('Cet agenda est en lecture seule.')
  if (input.calendarId !== ev.calendar_id) {
    // Moving between calendars = create in the new one, delete from the old.
    await createEvent(input)
    await deleteEvent(id)
    return
  }
  const account = getAccount(cal.account_id)
  if (account.kind === 'google') await googleUpdate(account, cal.remote_id, ev.remote_id, input)
  else await caldavUpdate(account, ev.remote_id, ev.etag, ev.ical ?? '', input)
  await afterWrite(account, input.start)
}

export async function deleteEvent(id: string): Promise<void> {
  const ev = eventRow(id)
  const cal = calendarRow(ev.calendar_id)
  if (cal.read_only) throw new Error('Cet agenda est en lecture seule.')
  const account = getAccount(cal.account_id)
  if (account.kind === 'google') await googleDelete(account, cal.remote_id, ev.remote_id)
  else await caldavDelete(account, ev.remote_id, ev.etag)
  await afterWrite(account, ev.start)
}
