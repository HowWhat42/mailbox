export interface RemoteCalendar {
  remoteId: string
  name: string
  color: string
  readOnly: boolean
}

export interface RemoteEvent {
  /** Google event id, or CalDAV object URL (+ "#<occurrence start>" for expanded recurrences). */
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
}
