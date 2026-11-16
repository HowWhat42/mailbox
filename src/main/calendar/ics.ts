import type { CalendarSource } from '@shared/types'
import { calendarName, eventsFrom, parseCalendar } from './ical'
import type { RemoteCalendar, RemoteEvent } from './types'

// One fetch per refresh: the feed is read for its name, then for its events.
const cache = new Map<string, { at: number; text: string }>()

async function fetchFeed(url: string): Promise<string> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < 60_000) return hit.text
  const res = await fetch(url, { headers: { Accept: 'text/calendar, */*' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Abonnement : le serveur a répondu ${res.status}.`)
  const text = await res.text()
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Abonnement : cette adresse ne renvoie pas un agenda iCalendar (.ics).')
  cache.set(url, { at: Date.now(), text })
  return text
}

/** A subscribed .ics feed (Outlook/Office 365 published calendar, iCloud public link, holidays…): read-only. */
export async function icsCalendars(source: CalendarSource): Promise<RemoteCalendar[]> {
  const root = parseCalendar(await fetchFeed(source.url!))
  const color = root.getFirstPropertyValue('x-apple-calendar-color')
  return [
    {
      remoteId: source.url!,
      name: calendarName(root) ?? source.name,
      color: color ? String(color).slice(0, 7) : source.color,
      readOnly: true,
      defaultReminders: []
    }
  ]
}

export async function icsEvents(source: CalendarSource, start: number, end: number): Promise<RemoteEvent[]> {
  const root = parseCalendar(await fetchFeed(source.url!))
  return eventsFrom(root, { idBase: source.url!, etag: null, raw: null, start, end, selfEmails: [], perUid: true })
}
