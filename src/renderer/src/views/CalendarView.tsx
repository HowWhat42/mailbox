import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Globe, Layers, Link2, MoreHorizontal, OctagonAlert, Plus, RefreshCw, Server } from 'lucide-react'
import type { Calendar, CalendarEvent, CalendarSource } from '@shared/types'
import { api, confirmDialog, useStore } from '../store'
import { isTyping, overlayOpen } from '../lib/shortcuts'
import { useLayout } from '../lib/layout'
import { Checkbox } from '../components/ui/Controls'
import { Menu, type MenuEntry } from '../components/ui/Menu'
import type { Anchor } from '../components/ui/Popover'
import { EventEditor, type EditorState } from './EventEditor'
import { MonthGrid, TimeGrid } from './calendar/Grids'
import { AgendaList } from './calendar/AgendaList'
import { EventPeek } from './calendar/EventPeek'
import { MiniMonth } from './calendar/MiniMonth'
import { AddSourceDialog } from './calendar/AddSourceDialog'

type Range = 'day' | 'week' | 'month' | 'agenda'
const WEEK_OPTS = { weekStartsOn: 1 as const, locale: fr }
const AGENDA_DAYS = 30
const SWATCHES = ['#8f86f0', '#6f8cff', '#38bdf8', '#2dd4bf', '#a3e635', '#fbbf24', '#fb923c', '#f87171', '#f472b6', '#c084fc']
const RANGE_LABEL: Record<Range, string> = { day: 'Jour', week: 'Semaine', month: 'Mois', agenda: 'Agenda' }

function rangeOf(anchor: Date, range: Range, dayCount: number): [Date, Date] {
  if (range === 'day') return [startOfDay(anchor), addDays(startOfDay(anchor), 1)]
  if (range === 'agenda') return [startOfDay(anchor), addDays(startOfDay(anchor), AGENDA_DAYS)]
  if (range === 'week' && dayCount < 7) return [startOfDay(anchor), addDays(startOfDay(anchor), dayCount)]
  if (range === 'week') return [startOfWeek(anchor, WEEK_OPTS), addDays(startOfWeek(anchor, WEEK_OPTS), 7)]
  return [startOfWeek(startOfMonth(anchor), WEEK_OPTS), addDays(endOfWeek(endOfMonth(anchor), WEEK_OPTS), 1)]
}

const SOURCE_ICON = { google: Globe, caldav: Server, ics: Link2 }

export function CalendarView() {
  const { toast } = useStore.getState()
  const focus = useStore((s) => s.calendarFocus)
  const [anchor, setAnchor] = useState(() => new Date())
  const [range, setRange] = useState<Range>(() => {
    try {
      const v = localStorage.getItem('calendar-range') as Range | null
      return v && v in RANGE_LABEL ? v : 'week'
    } catch {
      return 'week'
    }
  })
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [peek, setPeek] = useState<{ id: string; anchor: Anchor } | null>(null)
  const [menu, setMenu] = useState<{ anchor: Anchor; items: MenuEntry[] } | null>(null)
  const [adding, setAdding] = useState(false)
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

  const compact = width < 760
  const dayCount = width < 460 ? 1 : compact ? 3 : 7
  const pickRange = (r: Range): void => {
    setRange(r)
    try {
      localStorage.setItem('calendar-range', r)
    } catch {
      // not persisted
    }
  }

  const [start, end] = useMemo(() => rangeOf(anchor, range, dayCount), [anchor, range, dayCount])
  const days = useMemo(() => {
    const out: Date[] = []
    for (let d = start; d < end; d = addDays(d, 1)) out.push(d)
    return out
  }, [start, end])

  const reload = useCallback(async () => {
    const [srcs, cals, evs] = await Promise.all([
      api.calendar.sources(),
      api.calendar.calendars(),
      api.calendar.events(start.getTime(), end.getTime())
    ])
    setSources(srcs)
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

  // Coming from a reminder or the "next up" card: go to that day and open the event.
  useEffect(() => {
    if (!focus) return
    setAnchor(new Date(focus.start))
    if (range === 'month' || range === 'agenda') pickRange('week')
    if (!focus.eventId) {
      useStore.getState().focusEvent(null)
      return
    }
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-event-id="${focus.eventId}"]`)
      setPeek({ id: focus.eventId, anchor: el ?? { x: window.innerWidth / 2 - 200, y: 120 } })
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      useStore.getState().focusEvent(null)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const step = (dir: 1 | -1): void =>
    setAnchor((a) =>
      range === 'day'
        ? addDays(a, dir)
        : range === 'agenda'
          ? addDays(a, dir * 7)
          : range === 'week'
            ? dayCount < 7
              ? addDays(a, dir * dayCount)
              : addWeeks(a, dir)
            : addMonths(a, dir)
    )

  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars])
  const colorOf = useCallback((id: string) => calById.get(id)?.color ?? 'var(--accent)', [calById])
  const nameOf = useCallback((id: string) => calById.get(id)?.name ?? '', [calById])
  const writable = calendars.filter((c) => !c.readOnly && c.enabled)
  const busyDays = useMemo(() => new Set(events.map((e) => startOfDay(e.start).getTime())), [events])

  const create = (s: number, e: number, allDay: boolean): void => {
    if (!writable.length) {
      if (!sources.length) setAdding(true)
      else toast('Aucun agenda modifiable : les abonnements sont en lecture seule.', 'error')
      return
    }
    setEditor({ id: null, input: { calendarId: writable[0].id, title: '', location: '', description: '', start: s, end: e, allDay } })
  }
  const newNow = (): void => {
    const s = Math.ceil(Date.now() / 1_800_000) * 1_800_000
    create(s, s + 3_600_000, false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e) || editor || peek || adding || overlayOpen() || e.ctrlKey || e.metaKey || e.altKey) return
      if (useStore.getState().composer) return
      const map: Record<string, () => void> = {
        t: () => setAnchor(new Date()),
        d: () => pickRange('day'),
        w: () => pickRange('week'),
        m: () => pickRange('month'),
        a: () => pickRange('agenda'),
        ArrowLeft: () => step(-1),
        h: () => step(-1),
        ArrowRight: () => step(1),
        l: () => step(1),
        n: newNow
      }
      map[e.key]?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const sourceMenu = (s: CalendarSource): MenuEntry[] => [
    {
      label: 'Actualiser',
      icon: RefreshCw,
      onSelect: () => void api.calendar.refresh(start.getTime(), end.getTime()).catch((e: Error) => toast(e.message, 'error'))
    },
    ...(s.accountId
      ? []
      : ([
          'separator',
          {
            label: 'Retirer cet agenda',
            danger: true,
            onSelect: async () => {
              const ok = await confirmDialog({
                title: `Retirer « ${s.name} » ?`,
                body: 'Ses événements disparaîtront de Mailbox. Rien n’est supprimé sur le serveur.',
                confirmLabel: 'Retirer',
                tone: 'danger'
              })
              if (ok) {
                await api.calendar.removeSource(s.id)
                void reload()
              }
            }
          }
        ] satisfies MenuEntry[]))
  ]

  const calendarMenu = (c: Calendar): MenuEntry[] =>
    SWATCHES.map((color) => ({
      label: color === c.color ? 'Couleur actuelle' : 'Utiliser cette couleur',
      swatch: color,
      checked: color === c.color,
      onSelect: () => void api.calendar.setCalendarColor(c.id, color).then(reload)
    }))

  const toggle = async (c: Calendar): Promise<void> => {
    await api.calendar.setEnabled(c.id, !c.enabled)
    if (!c.enabled) void refresh()
    else void reload()
  }

  const title =
    range === 'day'
      ? format(start, 'EEEE d MMMM yyyy', { locale: fr })
      : range === 'agenda'
        ? `${format(start, 'd MMM', { locale: fr })} – ${format(addDays(end, -1), 'd MMM yyyy', { locale: fr })}`
        : range === 'week' && dayCount < 7
          ? dayCount === 1
            ? format(start, 'EEE d MMM', { locale: fr })
            : `${format(start, 'd', { locale: fr })}–${format(addDays(end, -1), 'd MMM', { locale: fr })}`
          : range === 'week' && !isSameMonth(start, addDays(end, -1))
            ? `${format(start, 'MMM', { locale: fr })} – ${format(addDays(end, -1), 'MMM yyyy', { locale: fr })}`
            : format(range === 'week' ? start : anchor, 'MMMM yyyy', { locale: fr })

  const peeked = peek ? events.find((e) => e.id === peek.id) : undefined
  const openEvent = (e: CalendarEvent, el: HTMLElement): void => setPeek({ id: e.id, anchor: el })
  const editEvent = (e: CalendarEvent): void => {
    setPeek(null)
    setEditor({
      id: e.id,
      input: {
        calendarId: e.calendarId,
        title: e.title,
        location: e.location,
        description: e.description,
        start: e.start,
        end: e.end,
        allDay: e.allDay
      },
      recurring: e.recurring,
      meetingUrl: e.meetingUrl
    })
  }

  const ranges: Range[] = ['day', 'week', 'month', 'agenda']

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {!single && (
        <aside className="flex w-[232px] shrink-0 flex-col border-r border-line">
          <div className="p-3">
            <button onClick={newNow} className="btn-primary flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-medium">
              <Plus size={15} /> Nouvel événement
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 pb-4">
            <MiniMonth value={anchor} rangeStart={start} rangeEnd={end} busyDays={busyDays} onPick={(d) => setAnchor(d)} />

            {sources.length === 0 && (
              <div className="rounded-xl border border-dashed border-line-strong px-3 py-4 text-center">
                <p className="text-[12.5px] text-fg-2">Aucun agenda connecté</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">Google, iCloud, Nextcloud ou un lien Outlook publié.</p>
              </div>
            )}

            {sources.map((s) => {
              const Icon = SOURCE_ICON[s.kind]
              const cals = calendars.filter((c) => c.sourceId === s.id)
              return (
                <div key={s.id}>
                  <div className="group flex h-7 items-center gap-2 px-2 text-[12px] font-medium text-muted">
                    <Icon size={13} />
                    <span className="min-w-0 flex-1 truncate" title={s.syncError ?? s.name}>
                      {s.name}
                    </span>
                    {s.syncError && <OctagonAlert size={13} className="text-danger" aria-label={s.syncError} />}
                    <button
                      onClick={(e) => setMenu({ anchor: e.currentTarget, items: sourceMenu(s) })}
                      aria-label={`Options de ${s.name}`}
                      className="grid size-6 place-items-center rounded-md opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                  {s.syncError && <p className="mx-2 mb-1 rounded-md bg-danger/10 px-2 py-1 text-[11.5px] text-danger">{s.syncError}</p>}
                  {cals.map((c) => (
                    <div
                      key={c.id}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: calendarMenu(c) })
                      }}
                      className="group flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] text-fg-2 hover:bg-hover"
                    >
                      <Checkbox checked={c.enabled} color={c.color} label={`Afficher ${c.name}`} onChange={() => void toggle(c)} />
                      <span className="min-w-0 flex-1 truncate" title={c.readOnly ? `${c.name} (lecture seule)` : c.name}>
                        {c.name}
                      </span>
                      <button
                        onClick={(e) => setMenu({ anchor: e.currentTarget, items: calendarMenu(c) })}
                        aria-label={`Couleur de ${c.name}`}
                        className="grid size-6 place-items-center rounded-md opacity-0 hover:bg-hover group-hover:opacity-100"
                      >
                        <span className="size-2.5 rounded-full" style={{ background: c.color }} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}

            <button
              onClick={() => setAdding(true)}
              className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-[13px] text-fg-2 hover:bg-hover hover:text-fg"
            >
              <Plus size={15} className="text-muted" /> Ajouter un agenda
            </button>
          </div>
        </aside>
      )}

      <div ref={body} className="@container flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
          <h1 className={`min-w-0 truncate font-semibold capitalize tracking-[-0.015em] ${compact ? 'text-[14px]' : 'min-w-44 text-[16px]'}`}>
            {title}
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setAnchor(new Date())}
              className="h-7 rounded-md border border-line px-2.5 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
              title="Aujourd’hui (T)"
            >
              {compact ? 'Auj.' : 'Aujourd’hui'}
            </button>
            <button
              onClick={() => step(-1)}
              aria-label="Précédent"
              className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => step(1)}
              aria-label="Suivant"
              className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => void refresh()}
              aria-label="Actualiser"
              title="Actualiser"
              className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <span className="flex-1" />
          {single && (
            <button
              onClick={(e) =>
                setMenu({
                  anchor: e.currentTarget,
                  items: [
                    ...(calendars.length
                      ? calendars.map((c) => ({ label: c.name, swatch: c.color, checked: c.enabled, onSelect: () => void toggle(c) }))
                      : [{ label: 'Aucun agenda', disabled: true, onSelect: () => {} }]),
                    'separator' as const,
                    { label: 'Ajouter un agenda…', icon: Plus, onSelect: () => setAdding(true) }
                  ]
                })
              }
              aria-label="Agendas affichés"
              title="Agendas affichés"
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <Layers size={15} />
            </button>
          )}
          {compact ? (
            <button
              onClick={(e) =>
                setMenu({
                  anchor: e.currentTarget,
                  items: ranges.map((r) => ({ label: RANGE_LABEL[r], checked: r === range, onSelect: () => pickRange(r) }))
                })
              }
              className="h-7 shrink-0 rounded-md border border-line px-2.5 text-[12px] text-fg-2 hover:bg-hover"
            >
              {RANGE_LABEL[range]}
            </button>
          ) : (
            <div className="flex shrink-0 rounded-lg border border-line p-0.5">
              {ranges.map((r) => (
                <button
                  key={r}
                  onClick={() => pickRange(r)}
                  title={`${RANGE_LABEL[r]} (${r === 'day' ? 'D' : r === 'week' ? 'W' : r === 'month' ? 'M' : 'A'})`}
                  className={`h-6 rounded-md px-2.5 text-[12px] ${range === r ? 'lit text-fg' : 'text-muted hover:text-fg'}`}
                >
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
          )}
          {single && (
            <button onClick={newNow} aria-label="Nouvel événement (N)" className="btn-primary grid size-7 shrink-0 place-items-center rounded-md">
              <Plus size={14} />
            </button>
          )}
        </header>

        {range === 'month' ? (
          <MonthGrid
            anchor={anchor}
            days={days}
            events={events}
            colorOf={colorOf}
            onCreate={create}
            onOpen={openEvent}
            onPickDay={(d) => {
              setAnchor(d)
              pickRange('day')
            }}
          />
        ) : range === 'agenda' ? (
          <AgendaList events={events} colorOf={colorOf} nameOf={nameOf} onOpen={openEvent} />
        ) : (
          <TimeGrid days={days} events={events} colorOf={colorOf} onCreate={create} onOpen={openEvent} />
        )}
      </div>

      {peek && peeked && (
        <EventPeek
          key={peeked.id}
          event={peeked}
          calendar={calById.get(peeked.calendarId)}
          anchor={peek.anchor}
          onClose={() => setPeek(null)}
          onEdit={() => editEvent(peeked)}
          onChanged={() => void reload()}
        />
      )}
      {menu && <Menu anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} minWidth={210} />}
      {adding && (
        <AddSourceDialog
          onClose={() => {
            setAdding(false)
            void reload()
          }}
        />
      )}
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
