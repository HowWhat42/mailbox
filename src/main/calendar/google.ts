import type { Account, EventInput } from '@shared/types'
import { googleAccessToken } from '../accounts/google'
import type { RemoteCalendar, RemoteEvent } from './types'

const API = 'https://www.googleapis.com/calendar/v3'

async function call<T>(account: Account, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await googleAccessToken(account.id)}`,
      'Content-Type': 'application/json',
      ...init.headers
    }
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(`Google Agenda : ${body?.error?.message ?? res.statusText}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

interface GTime {
  date?: string
  dateTime?: string
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

export async function googleCalendars(account: Account): Promise<RemoteCalendar[]> {
  const res = await call<{ items: { id: string; summary: string; backgroundColor?: string; accessRole: string; primary?: boolean }[] }>(
    account,
    '/users/me/calendarList'
  )
  return res.items.map((c) => ({
    remoteId: c.id,
    name: c.primary ? account.email : c.summary,
    color: c.backgroundColor ?? account.color,
    readOnly: !['owner', 'writer'].includes(c.accessRole)
  }))
}

export async function googleEvents(account: Account, calendarRemoteId: string, start: number, end: number): Promise<RemoteEvent[]> {
  const out: RemoteEvent[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: 'true',
      maxResults: '2500'
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await call<{
      items: {
        id: string
        status: string
        summary?: string
        location?: string
        description?: string
        start: GTime
        end: GTime
        recurringEventId?: string
        etag: string
      }[]
      nextPageToken?: string
    }>(account, `/calendars/${encodeURIComponent(calendarRemoteId)}/events?${params}`)
    for (const e of res.items) {
      if (e.status === 'cancelled') continue
      const s = parseTime(e.start)
      out.push({
        remoteId: e.id,
        etag: e.etag,
        ical: null,
        title: e.summary ?? '',
        location: e.location ?? '',
        description: e.description ?? '',
        start: s.ts,
        end: parseTime(e.end).ts,
        allDay: s.allDay,
        recurring: !!e.recurringEventId
      })
    }
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

export async function googleCreate(account: Account, calendarRemoteId: string, input: EventInput): Promise<void> {
  await call(account, `/calendars/${encodeURIComponent(calendarRemoteId)}/events`, { method: 'POST', body: body(input) })
}

export async function googleUpdate(account: Account, calendarRemoteId: string, eventId: string, input: EventInput): Promise<void> {
  await call(account, `/calendars/${encodeURIComponent(calendarRemoteId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: body(input)
  })
}

export async function googleDelete(account: Account, calendarRemoteId: string, eventId: string): Promise<void> {
  await call(account, `/calendars/${encodeURIComponent(calendarRemoteId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE'
  })
}
