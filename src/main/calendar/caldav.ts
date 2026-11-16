import { randomUUID } from 'node:crypto'
import { createDAVClient, type DAVCalendar } from 'tsdav'
import ICAL from 'ical.js'
import type { CalendarSource, EventInput, ResponseStatus } from '@shared/types'
import { caldavCredentials } from './sources'
import { eventsFrom, parseCalendar } from './ical'
import type { RemoteCalendar, RemoteEvent } from './types'

type DavClient = Awaited<ReturnType<typeof createDAVClient>>
type Component = InstanceType<typeof ICAL.Component>

const clients = new Map<string, { client: DavClient; calendars: DAVCalendar[] }>()

async function connect(source: CalendarSource): Promise<{ client: DavClient; calendars: DAVCalendar[] }> {
  const cached = clients.get(source.id)
  if (cached) return cached
  const { url, username, password } = caldavCredentials(source)
  const client = await createDAVClient({ serverUrl: url, credentials: { username, password }, authMethod: 'Basic', defaultAccountType: 'caldav' })
  const calendars = (await client.fetchCalendars()).filter((c) => !c.components || c.components.includes('VEVENT'))
  const entry = { client, calendars }
  clients.set(source.id, entry)
  return entry
}

export function forgetCaldav(sourceId: string): void {
  clients.delete(sourceId)
}

/** The object URL behind an event id (occurrence ids carry a "#occ=" suffix). */
const objectUrl = (remoteId: string): string => remoteId.split('#')[0]

function displayName(c: DAVCalendar): string {
  return typeof c.displayName === 'string' && c.displayName ? c.displayName : (c.url.split('/').filter(Boolean).pop() ?? 'Agenda')
}

export async function caldavCalendars(source: CalendarSource): Promise<RemoteCalendar[]> {
  forgetCaldav(source.id)
  const { calendars } = await connect(source)
  return calendars.map((c) => ({
    remoteId: c.url,
    name: displayName(c),
    color: (c as DAVCalendar & { calendarColor?: string }).calendarColor?.slice(0, 7) ?? source.color,
    readOnly: false,
    defaultReminders: []
  }))
}

function calendarByUrl(calendars: DAVCalendar[], url: string): DAVCalendar {
  const cal = calendars.find((c) => c.url === url)
  if (!cal) throw new Error('Agenda introuvable sur le serveur.')
  return cal
}

export async function caldavEvents(source: CalendarSource, calendarUrl: string, start: number, end: number): Promise<RemoteEvent[]> {
  const { client, calendars } = await connect(source)
  const objects = await client.fetchCalendarObjects({
    calendar: calendarByUrl(calendars, calendarUrl),
    timeRange: { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
  })
  const self = [source.username ?? ''].filter((e) => e.includes('@'))
  return objects.flatMap((o) => {
    try {
      return o.data ? eventsFrom(parseCalendar(o.data), { idBase: o.url, etag: o.etag ?? null, raw: o.data, start, end, selfEmails: self, perUid: false }) : []
    } catch {
      return []
    }
  })
}

function icalTime(ts: number, allDay: boolean): InstanceType<typeof ICAL.Time> {
  if (!allDay) return ICAL.Time.fromJSDate(new Date(ts), true)
  const d = new Date(ts)
  return ICAL.Time.fromData({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), isDate: true })
}

function applyInput(vevent: Component, input: EventInput): void {
  const event = new ICAL.Event(vevent)
  event.summary = input.title
  event.location = input.location
  event.description = input.description
  event.startDate = icalTime(input.start, input.allDay)
  event.endDate = icalTime(input.end, input.allDay)
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
}

export async function caldavCreate(source: CalendarSource, calendarUrl: string, input: EventInput): Promise<void> {
  const { client, calendars } = await connect(source)
  const uid = randomUUID()
  const cal = new ICAL.Component(['vcalendar', [], []])
  cal.updatePropertyWithValue('prodid', '-//Mailbox//FR')
  cal.updatePropertyWithValue('version', '2.0')
  const vevent = new ICAL.Component('vevent')
  vevent.updatePropertyWithValue('uid', uid)
  applyInput(vevent, input)
  cal.addSubcomponent(vevent)
  const res = await client.createCalendarObject({ calendar: calendarByUrl(calendars, calendarUrl), iCalString: cal.toString(), filename: `${uid}.ics` })
  if (!res.ok) throw new Error(`CalDAV : création refusée (${res.status}).`)
}

function master(root: Component): Component {
  const vevent = root.getAllSubcomponents('vevent').find((v) => !v.hasProperty('recurrence-id'))
  if (!vevent) throw new Error('Événement illisible.')
  return vevent
}

export async function caldavUpdate(source: CalendarSource, remoteId: string, etag: string | null, ical: string, input: EventInput, recurring: boolean): Promise<void> {
  if (recurring) throw new Error('La modification des événements récurrents CalDAV n’est pas encore prise en charge.')
  const { client } = await connect(source)
  const root = parseCalendar(ical)
  applyInput(master(root), input)
  const res = await client.updateCalendarObject({ calendarObject: { url: objectUrl(remoteId), etag: etag ?? undefined, data: root.toString() } })
  if (!res.ok) throw new Error(`CalDAV : modification refusée (${res.status}).`)
}

/** Deletes the whole object; for a recurring event that is the entire series. */
export async function caldavDelete(source: CalendarSource, remoteId: string, etag: string | null): Promise<void> {
  const { client } = await connect(source)
  const res = await client.deleteCalendarObject({ calendarObject: { url: objectUrl(remoteId), etag: etag ?? undefined } })
  if (!res.ok && res.status !== 404) throw new Error(`CalDAV : suppression refusée (${res.status}).`)
}

const PARTSTAT: Record<ResponseStatus, string> = { accepted: 'ACCEPTED', declined: 'DECLINED', tentative: 'TENTATIVE', needsAction: 'NEEDS-ACTION' }

/**
 * Sets our PARTSTAT on the event (whole series for recurring ones). Servers with
 * scheduling support (Nextcloud, Fastmail…) forward the answer to the organizer.
 */
export async function caldavRespond(source: CalendarSource, remoteId: string, etag: string | null, ical: string, status: ResponseStatus): Promise<void> {
  const { client } = await connect(source)
  const me = (source.username ?? '').toLowerCase()
  const root = parseCalendar(ical)
  let found = false
  for (const vevent of root.getAllSubcomponents('vevent')) {
    for (const p of vevent.getAllProperties('attendee')) {
      if (String(p.getFirstValue()).replace(/^mailto:/i, '').toLowerCase() === me) {
        p.setParameter('partstat', PARTSTAT[status])
        p.removeParameter('rsvp')
        found = true
      }
    }
  }
  if (!found) throw new Error('Vous ne figurez pas parmi les invités de cet événement.')
  const res = await client.updateCalendarObject({ calendarObject: { url: objectUrl(remoteId), etag: etag ?? undefined, data: root.toString() } })
  if (!res.ok) throw new Error(`CalDAV : réponse refusée (${res.status}).`)
}
