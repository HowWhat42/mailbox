import { createHash } from 'node:crypto'
import type { Calendar, CalendarEvent, CalendarPrefs, CalendarSource, EventInput, ResponseStatus } from '@shared/types'
import { getDb, tx } from '../db'
import { emit } from '../events'
import { getSource, listSources, setSourceResult, syncAccountSources } from './sources'
import { googleCalendars, googleCreate, googleDelete, googleEvents, googleRespond, googleUpdate } from './google'
import { caldavCalendars, caldavCreate, caldavDelete, caldavEvents, caldavRespond, caldavUpdate } from './caldav'
import { icsCalendars, icsEvents } from './ics'
import { parseGoogleRsvp } from './invite'
import type { RemoteCalendar, RemoteEvent } from './types'
import { checkReminders } from './reminders'

const DAY = 86_400_000
const BACKGROUND_EVERY = 5 * 60_000

interface CalendarRow {
  id: string
  source_id: string
  remote_id: string
  name: string
  color: string
  user_color: string | null
  read_only: number
  enabled: number
  default_reminders: string
  notify: number
  reminder_override: number | null
}

interface EventRow {
  id: string
  calendar_id: string
  source_id: string
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
  status: CalendarEvent['status']
  meeting_url: string | null
  meeting_provider: string | null
  attendees_json: string
  organizer: string | null
  my_status: ResponseStatus | null
  reminders_json: string | null
  web_link: string | null
  default_reminders: string
}

function localId(...parts: string[]): string {
  return createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 20)
}

function toEvent(r: EventRow): CalendarEvent {
  return {
    id: r.id,
    calendarId: r.calendar_id,
    sourceId: r.source_id,
    title: r.title,
    location: r.location,
    description: r.description,
    start: r.start,
    end: r.end,
    allDay: !!r.all_day,
    recurring: !!r.recurring,
    status: r.status,
    meetingUrl: r.meeting_url,
    meetingProvider: r.meeting_provider,
    attendees: JSON.parse(r.attendees_json),
    organizer: r.organizer,
    myStatus: r.my_status,
    reminders: JSON.parse(r.reminders_json ?? r.default_reminders),
    webLink: r.web_link
  }
}

const EVENT_SELECT = `SELECT e.*, c.default_reminders FROM events e JOIN calendars c ON c.id = e.calendar_id`

export function listCalendars(): Calendar[] {
  const rows = getDb().prepare('SELECT * FROM calendars ORDER BY name COLLATE NOCASE').all() as unknown as CalendarRow[]
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    name: r.name,
    color: r.user_color ?? r.color,
    readOnly: !!r.read_only,
    enabled: !!r.enabled,
    notify: !!r.notify,
    reminderOverride: r.reminder_override
  }))
}

export function setCalendarPrefs(id: string, prefs: Partial<CalendarPrefs>): void {
  const db = getDb()
  if (prefs.notify !== undefined) db.prepare('UPDATE calendars SET notify = ? WHERE id = ?').run(prefs.notify ? 1 : 0, id)
  if (prefs.reminderOverride !== undefined) db.prepare('UPDATE calendars SET reminder_override = ? WHERE id = ?').run(prefs.reminderOverride, id)
}

export function setCalendarEnabled(id: string, enabled: boolean): void {
  getDb()
    .prepare('UPDATE calendars SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, id)
}

export function setCalendarColor(id: string, color: string): void {
  getDb().prepare('UPDATE calendars SET user_color = ? WHERE id = ?').run(color, id)
}

export function listEvents(start: number, end: number): CalendarEvent[] {
  const rows = getDb()
    .prepare(`${EVENT_SELECT} WHERE c.enabled = 1 AND e.start < ? AND e.end > ? ORDER BY e.start`)
    .all(end, start) as unknown as EventRow[]
  return rows.map(toEvent)
}

export function getEvent(id: string): CalendarEvent | null {
  const row = getDb().prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id) as unknown as EventRow | undefined
  return row ? toEvent(row) : null
}

/** What's on now and next (today + tomorrow), declined invitations excluded. */
export function upcomingEvents(limit: number): CalendarEvent[] {
  const now = Date.now()
  const rows = getDb()
    .prepare(
      `${EVENT_SELECT} WHERE c.enabled = 1 AND e.all_day = 0 AND e.end > ? AND e.start < ?
         AND coalesce(e.my_status, '') <> 'declined' ORDER BY e.start LIMIT ?`
    )
    .all(now, now + 2 * DAY, limit) as unknown as EventRow[]
  return rows.map(toEvent)
}

async function fetchCalendars(source: CalendarSource): Promise<RemoteCalendar[]> {
  if (source.kind === 'google') return googleCalendars(source)
  if (source.kind === 'caldav') return caldavCalendars(source)
  return icsCalendars(source)
}

async function fetchEvents(source: CalendarSource, cal: CalendarRow, start: number, end: number): Promise<RemoteEvent[]> {
  if (source.kind === 'google') return googleEvents(source, cal.remote_id, start, end)
  if (source.kind === 'caldav') return caldavEvents(source, cal.remote_id, start, end)
  return icsEvents(source, start, end)
}

const running = new Map<string, Promise<void>>()

/** Refreshes one source for [start, end); concurrent calls for the same source share one run. */
export function refreshSource(sourceId: string, start: number, end: number): Promise<void> {
  const key = `${sourceId}:${start}:${end}`
  const current = running.get(key)
  if (current) return current
  const job = doRefresh(getSource(sourceId), start, end).finally(() => running.delete(key))
  running.set(key, job)
  return job
}

async function doRefresh(source: CalendarSource, start: number, end: number): Promise<void> {
  const db = getDb()
  try {
    const remote = await fetchCalendars(source)
    tx(() => {
      const upsert = db.prepare(
        `INSERT INTO calendars (id, source_id, remote_id, name, color, read_only, default_reminders) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source_id, remote_id) DO UPDATE SET name = excluded.name, color = excluded.color,
           read_only = excluded.read_only, default_reminders = excluded.default_reminders`
      )
      for (const c of remote)
        upsert.run(localId(source.id, c.remoteId), source.id, c.remoteId, c.name, c.color, c.readOnly ? 1 : 0, JSON.stringify(c.defaultReminders))
      const keep = new Set(remote.map((c) => c.remoteId))
      const local = db.prepare('SELECT id, remote_id FROM calendars WHERE source_id = ?').all(source.id) as { id: string; remote_id: string }[]
      for (const l of local) if (!keep.has(l.remote_id)) db.prepare('DELETE FROM calendars WHERE id = ?').run(l.id)
    })

    const calendars = db.prepare('SELECT * FROM calendars WHERE source_id = ? AND enabled = 1').all(source.id) as unknown as CalendarRow[]
    for (const cal of calendars) {
      const events = await fetchEvents(source, cal, start, end)
      tx(() => {
        // Replace the window: anything we had there that the server no longer returns is gone.
        db.prepare('DELETE FROM events WHERE calendar_id = ? AND start < ? AND end > ?').run(cal.id, end, start)
        const insert = db.prepare(
          `INSERT OR REPLACE INTO events (id, calendar_id, source_id, remote_id, etag, ical, title, location, description, start, end,
             all_day, recurring, status, meeting_url, meeting_provider, attendees_json, organizer, my_status, reminders_json, web_link)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const e of events) {
          insert.run(
            localId(cal.id, e.remoteId),
            cal.id,
            source.id,
            e.remoteId,
            e.etag,
            e.ical,
            e.title,
            e.location,
            e.description,
            e.start,
            e.end,
            e.allDay ? 1 : 0,
            e.recurring ? 1 : 0,
            e.status,
            e.meetingUrl,
            e.meetingProvider,
            JSON.stringify(e.attendees),
            e.organizer,
            e.myStatus,
            e.reminders ? JSON.stringify(e.reminders) : null,
            e.webLink
          )
        }
      })
    }
    setSourceResult(source.id, null)
  } catch (err) {
    setSourceResult(source.id, (err as Error).message)
    throw err
  } finally {
    emit('calendar:changed', { sourceId: source.id })
    checkReminders()
  }
}

/** Refreshes every source; failures are recorded per source and reported together. */
export async function refreshCalendars(start: number, end: number): Promise<void> {
  syncAccountSources()
  const results = await Promise.allSettled(listSources().map((s) => refreshSource(s.id, start, end)))
  const sources = listSources()
  const errors = results.flatMap((r, i) => (r.status === 'rejected' ? [`${sources[i]?.name ?? 'Agenda'} : ${(r.reason as Error).message}`] : []))
  if (errors.length) throw new Error(errors.join('\n'))
}

let timer: NodeJS.Timeout | null = null

/** Keeps the next weeks fresh in the background so reminders fire even if the calendar view is never opened. */
export function startCalendarSync(): void {
  const tick = (): void => {
    const now = Date.now()
    void refreshCalendars(now - 7 * DAY, now + 35 * DAY).catch(() => {})
  }
  tick()
  timer ??= setInterval(tick, BACKGROUND_EVERY)
}

export function stopCalendarSync(): void {
  if (timer) clearInterval(timer)
  timer = null
}

function calendarRow(id: string): CalendarRow {
  const row = getDb().prepare('SELECT * FROM calendars WHERE id = ?').get(id) as unknown as CalendarRow | undefined
  if (!row) throw new Error('Agenda introuvable.')
  return row
}

function eventRow(id: string): EventRow {
  const row = getDb().prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id) as unknown as EventRow | undefined
  if (!row) throw new Error('Événement introuvable.')
  return row
}

async function afterWrite(sourceId: string, around: number): Promise<void> {
  await refreshSource(sourceId, around - 45 * DAY, around + 45 * DAY)
}

export async function createEvent(input: EventInput): Promise<void> {
  const cal = calendarRow(input.calendarId)
  if (cal.read_only) throw new Error('Cet agenda est en lecture seule.')
  const source = getSource(cal.source_id)
  if (source.kind === 'google') await googleCreate(source, cal.remote_id, input)
  else if (source.kind === 'caldav') await caldavCreate(source, cal.remote_id, input)
  else throw new Error('Un abonnement est en lecture seule.')
  await afterWrite(source.id, input.start)
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
  const source = getSource(cal.source_id)
  if (source.kind === 'google') await googleUpdate(source, cal.remote_id, ev.remote_id, input)
  else await caldavUpdate(source, ev.remote_id, ev.etag, ev.ical ?? '', input, !!ev.recurring)
  await afterWrite(source.id, input.start)
}

export async function deleteEvent(id: string): Promise<void> {
  const ev = eventRow(id)
  const cal = calendarRow(ev.calendar_id)
  if (cal.read_only) throw new Error('Cet agenda est en lecture seule.')
  const source = getSource(cal.source_id)
  if (source.kind === 'google') await googleDelete(source, cal.remote_id, ev.remote_id)
  else await caldavDelete(source, ev.remote_id, ev.etag)
  await afterWrite(source.id, ev.start)
}

export async function respondToEvent(id: string, status: ResponseStatus): Promise<void> {
  const ev = eventRow(id)
  const cal = calendarRow(ev.calendar_id)
  const source = getSource(cal.source_id)
  if (source.kind === 'google') await googleRespond(source, cal.remote_id, ev.remote_id, status)
  else if (source.kind === 'caldav') await caldavRespond(source, ev.remote_id, ev.etag, ev.ical ?? '', status)
  else throw new Error('Impossible de répondre depuis un abonnement en lecture seule.')
  await afterWrite(source.id, ev.start)
}

/**
 * Answers a Google invitation from the Oui / Non / Peut-être link of its e-mail, through the
 * agenda connected in Mailbox. Returns null when the link isn't one, or when the invited agenda
 * isn't connected here: the caller then opens the link in the browser, as before.
 */
export async function respondToInvite(link: string): Promise<ResponseStatus | null> {
  const rsvp = parseGoogleRsvp(link)
  if (!rsvp) return null
  const cal = getDb()
    .prepare(
      `SELECT c.remote_id, c.source_id FROM calendars c JOIN cal_sources s ON s.id = c.source_id
       WHERE s.kind = 'google' AND lower(c.remote_id) = lower(?) LIMIT 1`
    )
    .get(rsvp.calendarId) as { remote_id: string; source_id: string } | undefined
  if (!cal) return null
  const source = getSource(cal.source_id)
  await googleRespond(source, cal.remote_id, rsvp.eventId, rsvp.status)
  await afterWrite(source.id, Date.now())
  return rsvp.status
}
