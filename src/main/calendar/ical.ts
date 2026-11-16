import ICAL from 'ical.js'
import type { Attendee, ResponseStatus } from '@shared/types'
import { findMeeting } from '@shared/meeting'
import type { RemoteEvent } from './types'

type Component = InstanceType<typeof ICAL.Component>
type IcalEvent = InstanceType<typeof ICAL.Event>

const PARTSTAT: Record<string, ResponseStatus> = {
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
  'NEEDS-ACTION': 'needsAction'
}

export function parseCalendar(data: string): Component {
  const root = new ICAL.Component(ICAL.parse(data))
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)
  return root
}

const mail = (v: unknown): string => String(v ?? '').replace(/^mailto:/i, '').trim().toLowerCase()

function attendeesOf(vevent: Component, self: Set<string>): { attendees: Attendee[]; organizer: string | null; organizerEmail: string } {
  const org = vevent.getFirstProperty('organizer')
  const organizerEmail = mail(org?.getFirstValue())
  const attendees = vevent.getAllProperties('attendee').map((p) => {
    const email = mail(p.getFirstValue())
    return {
      name: String(p.getParameter('cn') ?? ''),
      email,
      status: PARTSTAT[String(p.getParameter('partstat') ?? 'NEEDS-ACTION').toUpperCase()] ?? 'needsAction',
      organizer: email === organizerEmail,
      self: self.has(email)
    }
  })
  return { attendees, organizer: org ? String(org.getParameter('cn') ?? organizerEmail) || null : null, organizerEmail }
}

/** Popup reminders as "minutes before start"; absolute or end-relative triggers are ignored. */
function remindersOf(vevent: Component): number[] | null {
  const alarms = vevent.getAllSubcomponents('valarm')
  if (!alarms.length) return null
  const out: number[] = []
  for (const a of alarms) {
    const trigger = a.getFirstProperty('trigger')
    const value = trigger?.getFirstValue() as unknown
    if (!value || String(trigger?.getParameter('related') ?? 'START').toUpperCase() !== 'START') continue
    if (value instanceof ICAL.Duration) out.push(Math.max(0, Math.round(-value.toSeconds() / 60)))
  }
  return out
}

function textProp(vevent: Component, name: string): string {
  const v = vevent.getFirstPropertyValue(name)
  return v == null ? '' : String(v)
}

function describe(vevent: Component, item: IcalEvent, self: Set<string>) {
  const { attendees, organizer, organizerEmail } = attendeesOf(vevent, self)
  const me = attendees.find((a) => a.self)
  const meeting = findMeeting(
    textProp(vevent, 'x-microsoft-skypeteamsmeetingurl'),
    textProp(vevent, 'x-google-conference'),
    textProp(vevent, 'url'),
    item.location,
    item.description
  )
  const status = textProp(vevent, 'status').toUpperCase()
  return {
    title: item.summary ?? '',
    location: item.location ?? '',
    description: item.description ?? '',
    status: (status === 'TENTATIVE' ? 'tentative' : status === 'CANCELLED' ? 'cancelled' : 'confirmed') as RemoteEvent['status'],
    meetingUrl: meeting?.url ?? null,
    meetingProvider: meeting?.provider ?? null,
    attendees,
    organizer,
    myStatus: me && !self.has(organizerEmail) ? me.status : null,
    reminders: remindersOf(vevent),
    webLink: null
  }
}

/**
 * Concrete occurrences of every event in `root` overlapping [start, end).
 * `idBase` identifies the object (CalDAV URL) or feed; `selfEmails` mark the user among attendees.
 */
export function eventsFrom(
  root: Component,
  opts: { idBase: string; etag: string | null; raw: string | null; start: number; end: number; selfEmails: string[]; perUid: boolean }
): RemoteEvent[] {
  const self = new Set(opts.selfEmails.map((e) => e.toLowerCase()))
  const byUid = Map.groupBy(root.getAllSubcomponents('vevent'), (v) => textProp(v, 'uid'))
  const out: RemoteEvent[] = []

  for (const [uid, vevents] of byUid) {
    const master = vevents.find((v) => !v.hasProperty('recurrence-id')) ?? vevents[0]
    const event = new ICAL.Event(master)
    for (const ex of vevents) if (ex !== master && ex.hasProperty('recurrence-id')) event.relateException(ex)
    const base = opts.perUid ? `${opts.idBase}#${uid}` : opts.idBase
    const allDay = event.startDate.isDate
    const fallbackEnd = (s: number): number => s + (allDay ? 86_400_000 : 3_600_000)

    if (!event.isRecurring()) {
      const s = event.startDate.toJSDate().getTime()
      const e = event.endDate ? event.endDate.toJSDate().getTime() : fallbackEnd(s)
      if (s < opts.end && e > opts.start) {
        out.push({ remoteId: base, etag: opts.etag, ical: opts.raw, start: s, end: Math.max(e, s), allDay, recurring: false, ...describe(master, event, self) })
      }
      continue
    }

    const it = event.iterator()
    for (let next = it.next(), guard = 0; next && guard < 5000; next = it.next(), guard++) {
      const details = event.getOccurrenceDetails(next)
      const s = details.startDate.toJSDate().getTime()
      if (s >= opts.end) break
      const e = details.endDate.toJSDate().getTime()
      if (e <= opts.start) continue
      const item = details.item
      out.push({
        remoteId: `${base}#occ=${s}`,
        etag: opts.etag,
        ical: opts.raw,
        start: s,
        end: e,
        allDay,
        recurring: true,
        ...describe(item.component, item, self)
      })
    }
  }
  return out.filter((e) => e.status !== 'cancelled')
}

export function calendarName(root: Component): string | null {
  const v = root.getFirstPropertyValue('x-wr-calname')
  return v ? String(v) : null
}
