import { format, isSameDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { CalendarEvent } from '@shared/types'
import { api } from '../../store'

export const DAY = 86_400_000

/** "Join" is offered from 15 minutes before the start until the end. */
export function joinable(e: CalendarEvent, now = Date.now()): boolean {
  return !!e.meetingUrl && now >= e.start - 15 * 60_000 && now < e.end
}

export function join(e: CalendarEvent): void {
  if (e.meetingUrl) void api.app.openExternal(e.meetingUrl)
}

export function timeRange(e: CalendarEvent): string {
  if (e.allDay) {
    const last = e.end - DAY
    return last > e.start
      ? `${format(e.start, 'EEE d MMM', { locale: fr })} – ${format(last, 'EEE d MMM', { locale: fr })}`
      : `${format(e.start, 'EEEE d MMMM', { locale: fr })} · toute la journée`
  }
  if (isSameDay(e.start, e.end)) return `${format(e.start, 'EEEE d MMMM', { locale: fr })} · ${format(e.start, 'HH:mm')} – ${format(e.end, 'HH:mm')}`
  return `${format(e.start, 'EEE d MMM HH:mm', { locale: fr })} – ${format(e.end, 'EEE d MMM HH:mm', { locale: fr })}`
}

/** Visual treatment of the user's answer: declined fades out, unanswered/tentative get a hatched fill. */
export function answerStyle(e: CalendarEvent): { faded: boolean; hatched: boolean } {
  return {
    faded: e.myStatus === 'declined',
    hatched: e.myStatus === 'needsAction' || e.myStatus === 'tentative' || e.status === 'tentative'
  }
}

export const STATUS_LABEL = {
  accepted: 'Accepté',
  tentative: 'Provisoire',
  declined: 'Refusé',
  needsAction: 'Sans réponse'
} as const
