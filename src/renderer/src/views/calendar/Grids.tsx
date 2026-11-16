import { useEffect, useRef, useState } from 'react'
import { addDays, format, isSameMonth, isToday, startOfDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Repeat, Video } from 'lucide-react'
import type { CalendarEvent } from '@shared/types'
import { answerStyle, DAY, join, joinable } from './shared'

export const HOUR = 52

export type OpenEvent = (e: CalendarEvent, anchor: HTMLElement) => void
export type CreateEvent = (start: number, end: number, allDay: boolean) => void

/** Assigns side-by-side columns to overlapping timed events of one day. */
function layoutDay(events: CalendarEvent[]): { e: CalendarEvent; col: number; cols: number }[] {
  const sorted = events.toSorted((a, b) => a.start - b.start || b.end - a.end)
  const out: { e: CalendarEvent; col: number; cols: number }[] = []
  let cluster: { e: CalendarEvent; col: number; cols: number }[] = []
  let clusterEnd = 0
  const flush = (): void => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1))
    for (const c of cluster) out.push({ ...c, cols })
    cluster = []
  }
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => c.e.end > e.start).map((c) => c.col))
    let col = 0
    while (used.has(col)) col++
    cluster.push({ e, col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, e.end)
  }
  flush()
  return out
}

function useNow(every = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [every])
  return now
}

function fill(color: string, e: CalendarEvent, strength = 24): React.CSSProperties {
  const { faded, hatched } = answerStyle(e)
  const base = `color-mix(in oklch, ${color} ${strength}%, var(--surface-solid))`
  return {
    background: hatched
      ? `repeating-linear-gradient(135deg, ${base} 0 6px, color-mix(in oklch, ${color} ${Math.round(strength / 2)}%, var(--surface-solid)) 6px 12px)`
      : base,
    boxShadow: `inset 3px 0 0 ${color}`,
    opacity: faded ? 0.45 : 1,
    textDecoration: faded ? 'line-through' : undefined
  }
}

function TimedChip({ e, color, onOpen, style, now }: { e: CalendarEvent; color: string; onOpen: OpenEvent; style: React.CSSProperties; now: number }) {
  const short = e.end - e.start <= 45 * 60_000
  const canJoin = joinable(e, now)
  return (
    <div
      role="button"
      tabIndex={0}
      data-event-id={e.id}
      onClick={(ev) => {
        ev.stopPropagation()
        onOpen(e, ev.currentTarget)
      }}
      onKeyDown={(ev) => ev.key === 'Enter' && onOpen(e, ev.currentTarget)}
      title={`${e.title}${e.location ? `\n${e.location}` : ''}`}
      className="group absolute flex cursor-default flex-col overflow-hidden rounded-md py-1 pl-2 pr-1 text-left text-[11.5px] leading-tight text-fg transition-[filter] hover:brightness-125"
      style={{ ...style, ...fill(color, e) }}
    >
      <div className="flex min-w-0 items-start gap-1">
        <span className={`min-w-0 flex-1 truncate font-medium ${short ? '' : 'whitespace-normal [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]'}`}>
          {e.title || '(sans titre)'}
        </span>
        {canJoin && (
          <button
            onClick={(ev) => {
              ev.stopPropagation()
              join(e)
            }}
            title={`Rejoindre (${e.meetingProvider})`}
            aria-label="Rejoindre la réunion"
            className="btn-primary flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10.5px] font-semibold"
          >
            <Video size={11} />
            {!short && 'Rejoindre'}
          </button>
        )}
      </div>
      {!short && (
        <span className="tnum mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-fg-2">
          {format(e.start, 'HH:mm')} – {format(e.end, 'HH:mm')}
          {e.recurring && <Repeat size={9} />}
          {e.meetingUrl && !canJoin && <Video size={10} />}
        </span>
      )}
    </div>
  )
}

function NowLine({ now }: { now: number }) {
  const d = new Date(now)
  const top = (d.getHours() + d.getMinutes() / 60) * HOUR
  return (
    <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top }}>
      <div className="relative h-[2px] bg-accent shadow-[0_0_8px_var(--accent)]">
        <span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-accent" />
      </div>
    </div>
  )
}

export function TimeGrid({
  days,
  events,
  colorOf,
  onCreate,
  onOpen
}: {
  days: Date[]
  events: CalendarEvent[]
  colorOf: (calendarId: string) => string
  onCreate: CreateEvent
  onOpen: OpenEvent
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const now = useNow()
  useEffect(() => {
    const h = new Date().getHours()
    scroller.current?.scrollTo({ top: Math.max(0, Math.min(h - 1.5, 7.5)) * HOUR })
  }, [])

  const isAllDay = (e: CalendarEvent): boolean => e.allDay || e.end - e.start >= DAY
  const on = (day: Date, e: CalendarEvent): boolean => e.start < addDays(day, 1).getTime() && e.end > day.getTime()
  const allDay = (day: Date): CalendarEvent[] => events.filter((e) => isAllDay(e) && on(day, e))
  const timed = (day: Date): CalendarEvent[] => events.filter((e) => !isAllDay(e) && on(day, e))
  const hasAllDay = days.some((d) => allDay(d).length > 0)
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 border-b border-line pr-[10px]" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => (
          <div key={d.getTime()} className="flex items-baseline gap-1.5 px-2 py-2">
            <span className={`text-[12px] ${isToday(d) ? 'text-accent' : 'text-muted'}`}>{format(d, 'EEE', { locale: fr })}</span>
            <span
              className={`tnum grid min-w-7 place-items-center rounded-md px-1 text-[15px] font-semibold ${isToday(d) ? 'btn-primary' : ''}`}
            >
              {format(d, 'd')}
            </span>
          </div>
        ))}
        {hasAllDay && (
          <>
            <div className="pr-2 pt-1.5 text-right text-[10.5px] text-muted">jour</div>
            {days.map((d) => (
              <div key={d.getTime()} className="min-h-7 space-y-0.5 border-l border-line p-0.5" onDoubleClick={() => onCreate(d.getTime(), addDays(d, 1).getTime(), true)}>
                {allDay(d).map((e) => (
                  <button
                    key={e.id}
                    data-event-id={e.id}
                    onClick={(ev) => onOpen(e, ev.currentTarget)}
                    className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11.5px] font-medium"
                    style={fill(colorOf(e.calendarId), e, 32)}
                  >
                    {e.title || '(sans titre)'}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-scroll">
        <div className="relative grid" style={{ height: 24 * HOUR, gridTemplateColumns: cols }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} className="tnum absolute right-2 -translate-y-1/2 text-[10.5px] text-muted" style={{ top: (i + 1) * HOUR }}>
                {String(i + 1).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((day) => (
            // Click a slot to create an event there; from the keyboard, N creates one.
            <div
              key={day.getTime()}
              role="presentation"
              className={`relative border-l border-line ${isToday(day) ? 'bg-accent-soft/40' : ''}`}
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR - 1}px, var(--line) ${HOUR - 1}px ${HOUR}px)` }}
              onClick={(ev) => {
                const y = ev.clientY - (ev.currentTarget as HTMLElement).getBoundingClientRect().top
                const minutes = Math.floor((y / HOUR) * 2) * 30
                const start = startOfDay(day).getTime() + minutes * 60_000
                onCreate(start, start + 3_600_000, false)
              }}
            >
              {isToday(day) && <NowLine now={now} />}
              {layoutDay(timed(day)).map(({ e, col, cols: n }) => {
                const dayStart = startOfDay(day).getTime()
                const s = Math.max(e.start, dayStart)
                const en = Math.min(e.end, dayStart + DAY)
                const top = ((s - dayStart) / 3_600_000) * HOUR
                const height = Math.max(22, ((en - s) / 3_600_000) * HOUR - 2)
                return (
                  <TimedChip
                    key={e.id}
                    e={e}
                    now={now}
                    color={colorOf(e.calendarId)}
                    onOpen={onOpen}
                    style={{ top, height, left: `calc(${(col / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function MonthGrid({
  anchor,
  days,
  events,
  colorOf,
  onCreate,
  onOpen,
  onPickDay
}: {
  anchor: Date
  days: Date[]
  events: CalendarEvent[]
  colorOf: (calendarId: string) => string
  onCreate: CreateEvent
  onOpen: OpenEvent
  onPickDay: (d: Date) => void
}) {
  const weeks = days.length / 7
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((d) => (
          <div key={d.getTime()} className="px-2 py-2 text-[12px] text-muted">
            {format(d, 'EEE', { locale: fr })}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const dayEvents = events.filter((e) => e.start < addDays(d, 1).getTime() && e.end > d.getTime())
          return (
            <div
              key={d.getTime()}
              onDoubleClick={() => onCreate(d.getTime() + 9 * 3_600_000, d.getTime() + 10 * 3_600_000, false)}
              className={`min-h-0 overflow-hidden border-b border-l border-line p-1 ${isSameMonth(d, anchor) ? '' : 'bg-black/20'}`}
            >
              <button
                onClick={() => onPickDay(d)}
                title="Afficher ce jour"
                className={`tnum mb-0.5 grid min-w-6 place-items-center rounded-md px-1 text-[12px] ${
                  isToday(d) ? 'btn-primary font-semibold' : isSameMonth(d, anchor) ? 'text-fg-2 hover:bg-hover' : 'text-faint hover:bg-hover'
                }`}
              >
                {format(d, 'd')}
              </button>
              {dayEvents.slice(0, 4).map((e) => {
                const { faded } = answerStyle(e)
                return (
                  <button
                    key={e.id}
                    data-event-id={e.id}
                    onClick={(ev) => onOpen(e, ev.currentTarget)}
                    className={`flex w-full items-center gap-1.5 truncate rounded px-1 py-px text-left text-[11.5px] hover:bg-hover ${faded ? 'line-through opacity-50' : ''}`}
                  >
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: colorOf(e.calendarId) }} />
                    {!e.allDay && <span className="tnum text-muted">{format(e.start, 'HH:mm')}</span>}
                    <span className="truncate">{e.title || '(sans titre)'}</span>
                    {e.meetingUrl && <Video size={10} className="ml-auto shrink-0 text-muted" />}
                  </button>
                )
              })}
              {dayEvents.length > 4 && (
                <button onClick={() => onPickDay(d)} className="px-1 text-[11px] text-muted hover:text-fg">
                  +{dayEvents.length - 4} autres
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
