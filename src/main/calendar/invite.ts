import type { ResponseStatus } from '@shared/types'

export interface GoogleRsvp {
  eventId: string
  calendarId: string
  status: Exclude<ResponseStatus, 'needsAction'>
}

const STATUS: Record<string, GoogleRsvp['status']> = { '1': 'accepted', '2': 'declined', '3': 'tentative' }

/** Google shortens the calendar id inside `eid`. */
const SUFFIXES: Record<string, string> = { '@m': '@gmail.com', '@g': '@group.calendar.google.com' }

/**
 * The Oui / Non / Peut-être links of a Google Calendar invitation e-mail:
 * `https://calendar.google.com/calendar/event?action=RESPOND&eid=<base64 "eventId calendarId">&rst=1`.
 */
export function parseGoogleRsvp(link: string): GoogleRsvp | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  if (!/(^|\.)google\.com$/i.test(url.hostname) || !url.pathname.endsWith('/calendar/event')) return null
  if (url.searchParams.get('action') !== 'RESPOND') return null
  const status = STATUS[url.searchParams.get('rst') ?? '']
  const eid = url.searchParams.get('eid')
  if (!status || !eid) return null
  const [eventId, short] = Buffer.from(eid, 'base64url').toString('utf8').trim().split(/\s+/)
  if (!eventId || !short?.includes('@')) return null
  const at = short.lastIndexOf('@')
  const calendarId = short.slice(0, at) + (SUFFIXES[short.slice(at)] ?? short.slice(at))
  return { eventId, calendarId, status }
}
