import type { Attendee, CalendarSource, EventInput, ResponseStatus } from '@shared/types'
import { findMeeting } from '@shared/meeting'
import { googleTokenForSource } from './sources'
import type { RemoteCalendar, RemoteEvent } from './types'

const API = 'https://www.googleapis.com/calendar/v3'

async function call<T>(source: CalendarSource, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await googleTokenForSource(source)}`,
      'Content-Type': 'application/json',
      ...init.headers
    }
  })
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(`Google Agenda : ${payload?.error?.message ?? res.statusText}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

interface GTime {
  date?: string
  dateTime?: string
}

interface GAttendee {
  email: string
  displayName?: string
  responseStatus?: ResponseStatus
  self?: boolean
  organizer?: boolean
  resource?: boolean
}

interface GEvent {
  id: string
  status: string
  summary?: string
  location?: string
  description?: string
  start: GTime
  end: GTime
  recurringEventId?: string
  etag: string
  htmlLink?: string
  hangoutLink?: string
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[]; conferenceSolution?: { name?: string } }
  attendees?: GAttendee[]
  organizer?: { email?: string; displayName?: string; self?: boolean }
  reminders?: { useDefault?: boolean; overrides?: { method: string; minutes: number }[] }
}

function parseTime(t: GTime): { ts: number; allDay: boolean } {
  if (t.date) {
    const [y, m, d] = t.date.split('-').map(Number)
    return { ts: new Date(y, m - 1, d).getTime(), allDay: true }
  }
  return { ts: new Date(t.dateTime!).getTime(), allDay: false }
}

function toGTime(ts: number, allDay: boolean): GTime {
  if (!allDay) return { dateTime: new Date(ts).toISOString() }
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
}

function toRemote(e: GEvent): RemoteEvent {
  const s = parseTime(e.start)
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? e.hangoutLink
  const meeting = video
    ? { url: video, provider: findMeeting(video)?.provider ?? e.conferenceData?.conferenceSolution?.name ?? 'Visio' }
    : findMeeting(e.location, e.description)
  const attendees: Attendee[] = (e.attendees ?? [])
    .filter((a) => !a.resource)
    .map((a) => ({ name: a.displayName ?? '', email: a.email, status: a.responseStatus ?? 'needsAction', organizer: !!a.organizer, self: !!a.self }))
  const me = attendees.find((a) => a.self)
  return {
    remoteId: e.id,
    etag: e.etag,
    ical: null,
    title: e.summary ?? '',
    location: e.location ?? '',
    description: e.description ?? '',
    start: s.ts,
    end: parseTime(e.end).ts,
    allDay: s.allDay,
    recurring: !!e.recurringEventId,
    status: e.status === 'tentative' ? 'tentative' : 'confirmed',
    meetingUrl: meeting?.url ?? null,
    meetingProvider: meeting?.provider ?? null,
    attendees,
    organizer: e.organizer?.displayName ?? e.organizer?.email ?? null,
    myStatus: me && !me.organizer && !e.organizer?.self ? me.status : null,
    reminders: e.reminders?.useDefault === false ? (e.reminders.overrides ?? []).filter((r) => r.method === 'popup').map((r) => r.minutes) : null,
    webLink: e.htmlLink ?? null
  }
}

export async function googleCalendars(source: CalendarSource): Promise<RemoteCalendar[]> {
  const res = await call<{
    items: {
      id: string
      summary: string
      summaryOverride?: string
      backgroundColor?: string
      accessRole: string
      primary?: boolean
      defaultReminders?: { method: string; minutes: number }[]
    }[]
  }>(source, '/users/me/calendarList')
  return res.items.map((c) => ({
    remoteId: c.id,
    name: c.summaryOverride ?? (c.primary ? (source.username ?? c.summary) : c.summary),
    color: c.backgroundColor ?? source.color,
    readOnly: !['owner', 'writer'].includes(c.accessRole),
    defaultReminders: (c.defaultReminders ?? []).filter((r) => r.method === 'popup').map((r) => r.minutes)
  }))
}

export async function googleEvents(source: CalendarSource, calendarId: string, start: number, end: number): Promise<RemoteEvent[]> {
  const out: RemoteEvent[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: 'true',
      maxResults: '2500',
      conferenceDataVersion: '1'
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await call<{ items: GEvent[]; nextPageToken?: string }>(source, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`)
    for (const e of res.items) if (e.status !== 'cancelled') out.push(toRemote(e))
    pageToken = res.nextPageToken
  } while (pageToken)
  return out
}

function body(input: EventInput): string {
  return JSON.stringify({
    summary: input.title,
    location: input.location,
    description: input.description,
    start: toGTime(input.start, input.allDay),
    end: toGTime(input.end, input.allDay)
  })
}

const eventPath = (calendarId: string, eventId: string): string => `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`

export async function googleCreate(source: CalendarSource, calendarId: string, input: EventInput): Promise<void> {
  await call(source, `/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body: body(input) })
}

export async function googleUpdate(source: CalendarSource, calendarId: string, eventId: string, input: EventInput): Promise<void> {
  await call(source, eventPath(calendarId, eventId), { method: 'PATCH', body: body(input) })
}

export async function googleDelete(source: CalendarSource, calendarId: string, eventId: string): Promise<void> {
  await call(source, eventPath(calendarId, eventId), { method: 'DELETE' })
}

/** Accept / decline / tentative: rewrites our own attendee entry and notifies the organizer. */
export async function googleRespond(source: CalendarSource, calendarId: string, eventId: string, status: ResponseStatus): Promise<void> {
  const event = await call<GEvent>(source, eventPath(calendarId, eventId))
  const attendees = (event.attendees ?? []).map((a) => (a.self ? { ...a, responseStatus: status } : a))
  if (!attendees.some((a) => a.self)) throw new Error('Vous ne figurez pas parmi les invités de cet événement.')
  await call(source, `${eventPath(calendarId, eventId)}?sendUpdates=all`, { method: 'PATCH', body: JSON.stringify({ attendees }) })
}
