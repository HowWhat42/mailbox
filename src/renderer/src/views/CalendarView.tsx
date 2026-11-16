import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import { fr } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Layers, Plus, RefreshCw, Repeat } from 'lucide-react'
import type { Calendar, CalendarEvent } from '@shared/types'
import { api, useStore } from '../store'
import { isTyping } from '../lib/shortcuts'
import { EventEditor, type EditorState } from './EventEditor'
import { Checkbox } from '../components/ui/Controls'
import { Menu } from '../components/ui/Menu'
import { useLayout } from '../lib/layout'

type Range = 'week' | 'month'
const HOUR = 52
const WEEK_OPTS = { weekStartsOn: 1 as const, locale: fr }

/** `dayCount` < 7 is the narrow-window week: a few days starting at the anchor. */
function rangeOf(anchor: Date, range: Range, dayCount: number): [Date, Date] {
  if (range === 'week' && dayCount < 7) return [startOfDay(anchor), addDays(startOfDay(anchor), dayCount)]
  if (range === 'week') return [startOfWeek(anchor, WEEK_OPTS), addDays(startOfWeek(anchor, WEEK_OPTS), 7)]
  return [startOfWeek(startOfMonth(anchor), WEEK_OPTS), addDays(endOfWeek(endOfMonth(anchor), WEEK_OPTS), 1)]
}

/** Assigns side-by-side columns to overlapping timed events of one day. */
function layoutDay(events: CalendarEvent[]): { e: CalendarEvent; col: number; cols: number }[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end)
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

function NowLine() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const d = new Date(now)
  const top = (d.getHours() + d.getMinutes() / 60) * HOUR
  return (
    <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top }}>
      <div className="relative h-px bg-accent">
        <span className="absolute -left-1 -top-[3px] size-[7px] rounded-full bg-accent" />
      </div>
    </div>
  )
}

function EventChip({ e, color, onOpen, style }: { e: CalendarEvent; color: string; onOpen: () => void; style?: React.CSSProperties }) {
  const short = e.end - e.start <= 45 * 60_000
  return (
    <button
      onClick={(ev) => {
        ev.stopPropagation()
        onOpen()
      }}
      title={`${e.title}${e.location ? `\n${e.location}` : ''}`}
      className="absolute overflow-hidden rounded-[5px] px-1.5 py-1 text-left text-[11.5px] leading-tight transition-[filter] hover:brightness-110"
      style={{ ...style, background: `color-mix(in oklch, ${color} 22%, var(--surface-solid))`, boxShadow: `inset 2px 0 0 ${color}`, color: 'var(--fg)' }}
    >
      <span className={`block truncate font-medium ${short ? 'inline' : ''}`}>{e.title || '(sans titre)'}</span>
      <span className={`tnum truncate text-[10.5px] text-fg-2 ${short ? 'ml-1 inline' : 'block'}`}>
        {format(e.start, 'HH:mm')}
        {!short && ` – ${format(e.end, 'HH:mm')}`}
        {e.recurring && <Repeat size={9} className="ml-1 inline" />}
      </span>
    </button>
  )
}

function WeekGrid({ days, events, colorOf, onCreate, onOpen }: { days: Date[]; events: CalendarEvent[]; colorOf: (id: string) => string; onCreate: (start: number, end: number, allDay: boolean) => void; onOpen: (e: CalendarEvent) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 7.5 * HOUR })
  }, [])

  const allDay = (day: Date): CalendarEvent[] => events.filter((e) => (e.allDay || e.end - e.start >= 86_400_000) && e.start < addDays(day, 1).getTime() && e.end > day.getTime())
  const timed = (day: Date): CalendarEvent[] =>
    events.filter((e) => !e.allDay && e.end - e.start < 86_400_000 && e.start < addDays(day, 1).getTime() && e.end > day.getTime())
  const hasAllDay = days.some((d) => allDay(d).length > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 border-b border-line pr-[10px]" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((d) => (
          <div key={d.getTime()} className="flex items-baseline gap-1.5 px-2 py-2">
            <span className={`text-[12px] ${isToday(d) ? 'text-accent' : 'text-muted'}`}>{format(d, 'EEE', { locale: fr })}</span>
            <span className={`tnum text-[15px] font-semibold ${isToday(d) ? 'text-accent' : ''}`}>{format(d, 'd')}</span>
          </div>
        ))}
        {hasAllDay && (
          <>
            <div className="pr-2 pt-1 text-right text-[10.5px] text-muted">jour</div>
            {days.map((d) => (
              <div key={d.getTime()} className="min-h-7 space-y-0.5 border-l border-line p-0.5" onDoubleClick={() => onCreate(d.getTime(), addDays(d, 1).getTime(), true)}>
                {allDay(d).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => onOpen(e)}
                    className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11.5px] font-medium"
                    style={{ background: `color-mix(in oklch, ${colorOf(e.calendarId)} 28%, var(--surface-solid))` }}
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
        <div className="relative grid" style={{ height: 24 * HOUR, gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} className="tnum absolute right-2 -translate-y-1/2 text-[10.5px] text-muted" style={{ top: (i + 1) * HOUR }}>
                {String(i + 1).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div
              key={day.getTime()}
              className="relative border-l border-line"
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR - 1}px, var(--line) ${HOUR - 1}px ${HOUR}px)` }}
              onClick={(ev) => {
                const y = ev.clientY - (ev.currentTarget as HTMLElement).getBoundingClientRect().top
                const minutes = Math.floor((y / HOUR) * 2) * 30
                const start = startOfDay(day).getTime() + minutes * 60_000
                onCreate(start, start + 3_600_000, false)
              }}
            >
              {isToday(day) && <NowLine />}
              {layoutDay(timed(day)).map(({ e, col, cols }) => {
                const dayStart = startOfDay(day).getTime()
                const s = Math.max(e.start, dayStart)
                const en = Math.min(e.end, dayStart + 86_400_000)
                const top = ((s - dayStart) / 3_600_000) * HOUR
                const height = Math.max(20, ((en - s) / 3_600_000) * HOUR - 2)
                return (
                  <EventChip
                    key={e.id}
                    e={e}
                    color={colorOf(e.calendarId)}
                    onOpen={() => onOpen(e)}
                    style={{ top, height, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
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

function MonthGrid({ anchor, days, events, colorOf, onCreate, onOpen }: { anchor: Date; days: Date[]; events: CalendarEvent[]; colorOf: (id: string) => string; onCreate: (start: number, end: number, allDay: boolean) => void; onOpen: (e: CalendarEvent) => void }) {
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
              className={`min-h-0 overflow-hidden border-b border-l border-line p-1 ${isSameMonth(d, anchor) ? '' : 'bg-panel/60'}`}
            >
              <div className={`tnum mb-0.5 px-1 text-[12px] ${isToday(d) ? 'font-semibold text-accent' : isSameMonth(d, anchor) ? 'text-fg-2' : 'text-faint'}`}>{format(d, 'd')}</div>
              {dayEvents.slice(0, 4).map((e) => (
                <button key={e.id} onClick={() => onOpen(e)} className="flex w-full items-center gap-1.5 truncate rounded px-1 py-px text-left text-[11.5px] hover:bg-hover">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: colorOf(e.calendarId) }} />
                  {!e.allDay && <span className="tnum text-muted">{format(e.start, 'HH:mm')}</span>}
                  <span className="truncate">{e.title || '(sans titre)'}</span>
                </button>
              ))}
              {dayEvents.length > 4 && <div className="px-1 text-[11px] text-muted">+{dayEvents.length - 4} autres</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CalendarView() {
  const accounts = useStore((s) => s.accounts)
  const { toast } = useStore.getState()
  const [anchor, setAnchor] = useState(() => new Date())
  const [range, setRange] = useState<Range>('week')
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [calMenu, setCalMenu] = useState<HTMLElement | null>(null)
  const { single } = useLayout()
  const body = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)

  useEffect(() => {
    const el = body.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Narrow: week view shows 3 days (or 1 on a very small window) so columns stay readable.
  const compact = width < 760
  const dayCount = width < 460 ? 1 : compact ? 3 : 7

  const [start, end] = useMemo(() => rangeOf(anchor, range, dayCount), [anchor, range, dayCount])
  const days = useMemo(() => {
    const out: Date[] = []
    for (let d = start; d < end; d = addDays(d, 1)) out.push(d)
    return out
  }, [start, end])

  const reload = useCallback(async () => {
    const [cals, evs] = await Promise.all([api.calendar.calendars(), api.calendar.events(start.getTime(), end.getTime())])
    setCalendars(cals)
    setEvents(evs)
  }, [start, end])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      await api.calendar.refresh(start.getTime(), end.getTime())
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
      void reload()
    }
  }, [start, end, reload, toast])

  useEffect(() => {
    void reload()
    void refresh()
  }, [reload, refresh])

  useEffect(() => api.app.on('calendar:changed', () => void reload()), [reload])

  const step = (dir: 1 | -1): void =>
    setAnchor((a) => (range === 'week' ? (dayCount < 7 ? addDays(a, dir * dayCount) : addWeeks(a, dir)) : addMonths(a, dir)))
  const colorOf = useCallback((id: string) => calendars.find((c) => c.id === id)?.color ?? 'var(--accent)', [calendars])
  const writable = calendars.filter((c) => !c.readOnly && c.enabled)

  const create = (s: number, e: number, allDay: boolean): void => {
    if (!writable.length) {
      toast(accounts.some((a) => a.kind === 'google' || a.caldavUrl) ? 'Aucun agenda modifiable.' : 'Ajoutez un compte Google ou une URL CalDAV dans les réglages pour utiliser le calendrier.', 'error')
      return
    }
    setEditor({ id: null, input: { calendarId: writable[0].id, title: '', location: '', description: '', start: s, end: e, allDay } })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e) || editor || e.ctrlKey || e.metaKey || e.altKey) return
      const s = useStore.getState()
      if (s.composer || s.paletteOpen || s.setupOpen || s.settingsOpen) return
      if (e.key === 't') setAnchor(new Date())
      else if (e.key === 'w') setRange('week')
      else if (e.key === 'm') setRange('month')
      else if (e.key === 'ArrowLeft' || e.key === 'h') step(-1)
      else if (e.key === 'ArrowRight' || e.key === 'l') step(1)
      else if (e.key === 'n') {
        const startTs = Math.ceil(Date.now() / 1_800_000) * 1_800_000
        create(startTs, startTs + 3_600_000, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const title = range === 'week' && dayCount < 7
    ? dayCount === 1
      ? format(start, 'EEE d MMM', { locale: fr })
      : `${format(start, 'd', { locale: fr })}–${format(addDays(end, -1), 'd MMM', { locale: fr })}`
    : range === 'week' && !isSameMonth(start, addDays(end, -1))
    ? `${format(start, 'MMM', { locale: fr })} – ${format(addDays(end, -1), 'MMM yyyy', { locale: fr })}`
    : format(range === 'week' ? start : anchor, 'MMMM yyyy', { locale: fr })

  const byAccount = accounts.map((a) => ({ account: a, cals: calendars.filter((c) => c.accountId === a.id) })).filter((g) => g.cals.length)

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className={`w-[212px] shrink-0 flex-col border-r border-line ${single ? 'hidden' : 'flex'}`}>
        <div className="h-4 shrink-0" />
        <div className="space-y-4 overflow-y-auto px-3 pb-4">
          {byAccount.length === 0 && (
            <p className="px-1 text-[12.5px] leading-5 text-muted">
              Aucun agenda pour l’instant. Les comptes Google en ont un automatiquement ; pour un autre compte, ajoutez son URL CalDAV dans les réglages.
            </p>
          )}
          {byAccount.map(({ account, cals }) => (
            <div key={account.id}>
              <div className="mb-1 truncate px-1 text-[12px] font-medium text-muted">{account.name}</div>
              {cals.map((c) => (
                <div key={c.id} className="flex h-8 items-center gap-2.5 rounded-lg px-1.5 text-[13px] text-fg-2 hover:bg-hover">
                  <Checkbox
                    checked={c.enabled}
                    color={c.color}
                    label={`Afficher ${c.name}`}
                    onChange={async (checked) => {
                      await api.calendar.setEnabled(c.id, checked)
                      if (checked) void refresh()
                      else void reload()
                    }}
                  />
                  <span className="truncate">{c.name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <div ref={body} className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
          <h1 className={`min-w-0 truncate font-semibold capitalize tracking-[-0.015em] ${compact ? 'text-[14px]' : 'min-w-44 text-[16px]'}`}>{title}</h1>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => setAnchor(new Date())} className="h-7 rounded-md border border-line px-2.5 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg" title="Aujourd’hui (T)">
              {compact ? 'Auj.' : 'Aujourd’hui'}
            </button>
            <button onClick={() => step(-1)} aria-label="Précédent" className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => step(1)} aria-label="Suivant" className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
              <ChevronRight size={16} />
            </button>
            <button onClick={() => void refresh()} aria-label="Actualiser" className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          {single && (
            <button
              onClick={(e) => setCalMenu(e.currentTarget)}
              aria-label="Agendas affichés"
              title="Agendas affichés"
              className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <Layers size={15} />
            </button>
          )}
          {calMenu && (
            <Menu
              anchor={calMenu}
              align="end"
              onClose={() => setCalMenu(null)}
              items={
                calendars.length
                  ? calendars.map((c) => ({
                      label: c.name,
                      swatch: c.color,
                      checked: c.enabled,
                      onSelect: () =>
                        void api.calendar.setEnabled(c.id, !c.enabled).then(() => (c.enabled ? reload() : refresh()))
                    }))
                  : [{ label: 'Aucun agenda configuré', disabled: true, onSelect: () => {} }]
              }
            />
          )}
          <div className={`flex shrink-0 rounded-md border border-line p-0.5 ${single ? '' : 'ml-auto'}`}>
            {(['week', 'month'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`h-6 rounded px-2.5 text-[12px] ${range === r ? 'bg-hover text-fg' : 'text-muted hover:text-fg'}`}
              >
                {r === 'week' ? (dayCount < 7 ? `${dayCount} j` : 'Semaine') : 'Mois'}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              const s = Math.ceil(Date.now() / 1_800_000) * 1_800_000
              create(s, s + 3_600_000, false)
            }}
            aria-label="Nouvel événement (N)"
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md btn-primary px-2.5 text-[12.5px] font-medium"
          >
            <Plus size={14} /> {!compact && 'Événement'}
          </button>
        </header>
        {range === 'week' ? (
          <WeekGrid days={days} events={events} colorOf={colorOf} onCreate={create} onOpen={(e) => setEditor({ id: e.id, input: { calendarId: e.calendarId, title: e.title, location: e.location, description: e.description, start: e.start, end: e.end, allDay: e.allDay }, recurring: e.recurring })} />
        ) : (
          <MonthGrid anchor={anchor} days={days} events={events} colorOf={colorOf} onCreate={create} onOpen={(e) => setEditor({ id: e.id, input: { calendarId: e.calendarId, title: e.title, location: e.location, description: e.description, start: e.start, end: e.end, allDay: e.allDay }, recurring: e.recurring })} />
        )}
      </div>

      {editor && (
        <EventEditor
          state={editor}
          calendars={calendars}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            void reload()
          }}
        />
      )}
    </div>
  )
}

