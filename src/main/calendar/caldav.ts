import { randomUUID } from 'node:crypto'
import { createDAVClient, type DAVCalendar } from 'tsdav'
import ICAL from 'ical.js'
import type { Account, EventInput } from '@shared/types'
import { getSecret } from '../accounts/store'
import type { RemoteCalendar, RemoteEvent } from './types'

type DavClient = Awaited<ReturnType<typeof createDAVClient>>

const clients = new Map<string, { client: DavClient; calendars: DAVCalendar[] }>()

async function connect(account: Account): Promise<{ client: DavClient; calendars: DAVCalendar[] }> {
  const cached = clients.get(account.id)
  if (cached) return cached
  if (!account.caldavUrl) throw new Error('Aucune URL CalDAV configurée pour ce compte.')
  const client = await createDAVClient({
    serverUrl: account.caldavUrl,
    credentials: { username: account.username, password: getSecret(account.id).password ?? '' },
    authMethod: 'Basic',
    defaultAccountType: 'caldav'
  })
  const calendars = (await client.fetchCalendars()).filter((c) => !c.components || c.components.includes('VEVENT'))
  const entry = { client, calendars }
  clients.set(account.id, entry)
  return entry
}

export function forgetCaldav(accountId: string): void {
  clients.delete(accountId)
}

function displayName(c: DAVCalendar): string {
  return typeof c.displayName === 'string' && c.displayName ? c.displayName : c.url.split('/').filter(Boolean).pop() ?? 'Agenda'
}

export async function caldavCalendars(account: Account): Promise<RemoteCalendar[]> {
  forgetCaldav(account.id)
  const { calendars } = await connect(account)
  return calendars.map((c) => ({
    remoteId: c.url,
    name: displayName(c),
    color: (c as DAVCalendar & { calendarColor?: string }).calendarColor?.slice(0, 7) ?? account.color,
    readOnly: false
  }))
}

function calendarByUrl(calendars: DAVCalendar[], url: string): DAVCalendar {
  const cal = calendars.find((c) => c.url === url)
  if (!cal) throw new Error('Agenda introuvable sur le serveur.')
  return cal
}

/** Expands one .ics object into concrete occurrences overlapping [start, end). */
function expand(url: string, etag: string | null, data: string, start: number, end: number): RemoteEvent[] {
  const root = new ICAL.Component(ICAL.parse(data))
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)
  const vevents = root.getAllSubcomponents('vevent')
  const master = vevents.find((v) => !v.hasProperty('recurrence-id'))
  if (!master) return []
  const event = new ICAL.Event(master)
  for (const ex of vevents) if (ex !== master) event.relateException(ex)

  const base = {
    etag,
    ical: data,
    title: event.summary ?? '',
    location: event.location ?? '',
    description: event.description ?? ''
  }
  const allDay = event.startDate.isDate

  if (!event.isRecurring()) {
    const s = event.startDate.toJSDate().getTime()
    const e = event.endDate ? event.endDate.toJSDate().getTime() : s + (allDay ? 86_400_000 : 3_600_000)
    return s < end && e > start ? [{ ...base, remoteId: url, start: s, end: e, allDay, recurring: false }] : []
  }

  const out: RemoteEvent[] = []
  const it = event.iterator()
  for (let next = it.next(), guard = 0; next && guard < 5000; next = it.next(), guard++) {
    const details = event.getOccurrenceDetails(next)
    const s = details.startDate.toJSDate().getTime()
    if (s >= end) break
    const e = details.endDate.toJSDate().getTime()
    if (e <= start) continue
    out.push({
      ...base,
      title: details.item.summary ?? base.title,
      location: details.item.location ?? base.location,
      remoteId: `${url}#${s}`,
      start: s,
      end: e,
      allDay,
      recurring: true
    })
  }
  return out
}

export async function caldavEvents(account: Account, calendarUrl: string, start: number, end: number): Promise<RemoteEvent[]> {
  const { client, calendars } = await connect(account)
  const objects = await client.fetchCalendarObjects({
    calendar: calendarByUrl(calendars, calendarUrl),
    timeRange: { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
  })
  return objects.flatMap((o) => {
    try {
      return o.data ? expand(o.url, o.etag ?? null, o.data, start, end) : []
    } catch {
      return []
    }
  })
}

function icalTime(ts: number, allDay: boolean): ICAL.Time {
  if (!allDay) return ICAL.Time.fromJSDate(new Date(ts), true)
  const d = new Date(ts)
  return ICAL.Time.fromData({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), isDate: true })
}

function applyInput(vevent: ICAL.Component, input: EventInput): void {
  const event = new ICAL.Event(vevent)
  event.summary = input.title
  event.location = input.location
  event.description = input.description
  event.startDate = icalTime(input.start, input.allDay)
  event.endDate = icalTime(input.end, input.allDay)
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
}

export async function caldavCreate(account: Account, calendarUrl: string, input: EventInput): Promise<void> {
  const { client, calendars } = await connect(account)
  const uid = randomUUID()
  const cal = new ICAL.Component(['vcalendar', [], []])
  cal.updatePropertyWithValue('prodid', '-//Mailbox//FR')
  cal.updatePropertyWithValue('version', '2.0')
  const vevent = new ICAL.Component('vevent')
  vevent.updatePropertyWithValue('uid', uid)
  applyInput(vevent, input)
  cal.addSubcomponent(vevent)
  const res = await client.createCalendarObject({
    calendar: calendarByUrl(calendars, calendarUrl),
    iCalString: cal.toString(),
    filename: `${uid}.ics`
  })
  if (!res.ok) throw new Error(`CalDAV : création refusée (${res.status}).`)
}

export async function caldavUpdate(account: Account, remoteId: string, etag: string | null, ical: string, input: EventInput): Promise<void> {
  if (remoteId.includes('#')) throw new Error('La modification des événements récurrents CalDAV n’est pas encore prise en charge.')
  const { client } = await connect(account)
  const root = new ICAL.Component(ICAL.parse(ical))
  const vevent = root.getFirstSubcomponent('vevent')
  if (!vevent) throw new Error('Événement illisible.')
  applyInput(vevent, input)
  const res = await client.updateCalendarObject({ calendarObject: { url: remoteId, etag: etag ?? undefined, data: root.toString() } })
  if (!res.ok) throw new Error(`CalDAV : modification refusée (${res.status}).`)
}

/** Deletes the whole object; for a recurring event that is the entire series. */
export async function caldavDelete(account: Account, remoteId: string, etag: string | null): Promise<void> {
  const { client } = await connect(account)
  const url = remoteId.split('#')[0]
  const res = await client.deleteCalendarObject({ calendarObject: { url, etag: etag ?? undefined } })
  if (!res.ok && res.status !== 404) throw new Error(`CalDAV : suppression refusée (${res.status}).`)
}
