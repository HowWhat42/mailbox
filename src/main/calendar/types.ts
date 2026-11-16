import type { Attendee, ResponseStatus } from '@shared/types'

export interface RemoteCalendar {
  remoteId: string
  name: string
  color: string
  readOnly: boolean
  /** Minutes before start applied to events that don't set their own reminders. */
  defaultReminders: number[]
}

export interface RemoteEvent {
  /** Google event id, or CalDAV/ICS object URL (+ "#<occurrence start>" for expanded recurrences). */
  remoteId: string
  etag: string | null
  ical: string | null
  title: string
  location: string
  description: string
  start: number
  end: number
  allDay: boolean
  recurring: boolean
  status: 'confirmed' | 'tentative' | 'cancelled'
  meetingUrl: string | null
  meetingProvider: string | null
  attendees: Attendee[]
  organizer: string | null
  myStatus: ResponseStatus | null
  /** null = use the calendar's defaults. */
  reminders: number[] | null
  webLink: string | null
}
