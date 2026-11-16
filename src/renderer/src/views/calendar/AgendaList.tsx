import { useEffect, useState } from 'react'
import { format, isToday, isTomorrow, startOfDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { MapPin, Users, Video } from 'lucide-react'
import type { CalendarEvent } from '@shared/types'
import { answerStyle, DAY, join, joinable } from './shared'
import type { OpenEvent } from './Grids'

function dayLabel(d: number): string {
  const name = format(d, 'EEEE d MMMM', { locale: fr })
  if (isToday(d)) return `Aujourd’hui · ${name}`
  if (isTomorrow(d)) return `Demain · ${name}`
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Outlook-style agenda: every upcoming event, day by day, with Join right there. */
export function AgendaList({ events, colorOf, nameOf, onOpen }: { events: CalendarEvent[]; colorOf: (id: string) => string; nameOf: (id: string) => string; onOpen: OpenEvent }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // An event spanning several days is listed on each of them.
  const byDay = new Map<number, CalendarEvent[]>()
  for (const e of events) {
    for (let d = startOfDay(e.start).getTime(); d < e.end; d += DAY) {
      if (!byDay.has(d)) byDay.set(d, [])
      byDay.get(d)!.push(e)
      if (!e.allDay) break
    }
  }
  const days = [...byDay.keys()].sort((a, b) => a - b)

  if (!days.length) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div>
          <p className="text-[13.5px] font-medium text-fg-2">Rien de prévu sur cette période</p>
          <p className="mt-1 text-[12.5px] text-muted">Appuyez sur N pour ajouter un événement.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-10 pt-2 @[700px]:px-6">
      {days.map((d) => (
        <section key={d} className="mt-4">
          <h3 className={`mb-1.5 px-2 text-[12.5px] font-semibold ${isToday(d) ? 'text-accent' : 'text-fg-2'}`}>{dayLabel(d)}</h3>
          <div className="space-y-1">
            {byDay
              .get(d)!
              .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
              .map((e) => {
                const { faded } = answerStyle(e)
                const live = !e.allDay && now >= e.start && now < e.end
                return (
                  <div
                    key={`${d}:${e.id}`}
                    role="button"
                    tabIndex={0}
                    data-event-id={e.id}
                    onClick={(ev) => onOpen(e, ev.currentTarget)}
                    onKeyDown={(ev) => ev.key === 'Enter' && onOpen(e, ev.currentTarget)}
                    className={`group flex cursor-default items-center gap-3 rounded-xl px-2 py-2 hover:bg-hover ${live ? 'lit' : ''} ${faded ? 'opacity-50' : ''}`}
                  >
                    <div className="tnum w-[88px] shrink-0 text-[12px] text-fg-2">
                      {e.allDay ? 'Toute la journée' : `${format(e.start, 'HH:mm')} – ${format(e.end, 'HH:mm')}`}
                    </div>
                    <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: colorOf(e.calendarId) }} />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-[13.5px] font-medium ${faded ? 'line-through' : ''}`}>
                        {e.title || '(sans titre)'}
                        {e.myStatus === 'needsAction' && <span className="ml-2 rounded bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold text-accent">À répondre</span>}
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-muted">
                        <span className="truncate">{nameOf(e.calendarId)}</span>
                        {(e.meetingProvider || e.location) && (
                          <>
                            <span>·</span>
                            {e.meetingProvider ? <Video size={12} /> : <MapPin size={12} />}
                            <span className="truncate">{e.meetingProvider ?? e.location}</span>
                          </>
                        )}
                        {e.attendees.length > 1 && (
                          <>
                            <span>·</span>
                            <Users size={12} />
                            <span>{e.attendees.length}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {e.meetingUrl && (
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation()
                          join(e)
                        }}
                        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold ${
                          joinable(e, now) ? 'btn-primary' : 'border border-line text-fg-2 hover:bg-hover hover:text-fg'
                        }`}
                      >
                        <Video size={14} /> Rejoindre
                      </button>
                    )}
                  </div>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )
}
