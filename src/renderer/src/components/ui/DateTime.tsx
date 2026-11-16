import { useEffect, useRef, useState } from 'react'
import { addDays, addMonths, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { Popover } from './Popover'

const triggerCls =
  'flex h-9 w-full items-center gap-2 rounded-md border border-line bg-panel px-3 text-left text-[13px] text-fg hover:border-line-strong disabled:opacity-60'

/** Day picker; `value` and the result are local-midnight-agnostic timestamps (time of day is kept). */
export function DatePicker({ value, onChange, disabled }: { value: number; onChange: (ts: number) => void; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [month, setMonth] = useState(() => startOfMonth(value))
  const selected = new Date(value)

  const first = startOfWeek(month, { weekStartsOn: 1 })
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i))

  const pick = (d: Date): void => {
    const next = new Date(d)
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0)
    onChange(next.getTime())
    setAnchor(null)
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          // Opening shows the month of the current value.
          setMonth(startOfMonth(value))
          setAnchor(anchor ? null : e.currentTarget)
        }}
        className={triggerCls}
      >
        <CalendarDays size={14} className="text-muted" />
        <span className="capitalize">{format(value, 'EEE d MMM yyyy', { locale: fr })}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          <div className="w-[252px] p-2">
            <div className="mb-2 flex items-center">
              <span className="flex-1 pl-1 text-[13px] font-semibold capitalize">{format(month, 'MMMM yyyy', { locale: fr })}</span>
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, -1))}
                aria-label="Mois précédent"
                className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, 1))}
                aria-label="Mois suivant"
                className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] text-muted">
              {['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].map((d) => (
                <span key={d} className="pb-1">
                  {d}
                </span>
              ))}
              {days.map((d) => (
                <button
                  key={d.getTime()}
                  type="button"
                  onClick={() => pick(d)}
                  className={`tnum mx-auto grid size-8 place-items-center rounded-md text-[12.5px] ${
                    isSameDay(d, selected)
                      ? 'btn-primary font-semibold'
                      : isToday(d)
                        ? 'font-semibold text-accent hover:bg-hover'
                        : isSameMonth(d, month)
                          ? 'text-fg hover:bg-hover'
                          : 'text-faint hover:bg-hover'
                  }`}
                >
                  {format(d, 'd')}
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  )
}

/** Time of day in 15-minute steps; keeps the date part of `value`. */
export function TimePicker({ value, onChange, disabled }: { value: number; onChange: (ts: number) => void; disabled?: boolean }) {
  const list = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const open = !!anchor
  const current = new Date(value)
  const minutes = current.getHours() * 60 + current.getMinutes()
  const slots = Array.from({ length: 96 }, (_, i) => i * 15)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => list.current?.querySelector('[data-current=true]')?.scrollIntoView({ block: 'center' }))
  }, [open])

  return (
    <>
      <button type="button" disabled={disabled} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} className={triggerCls}>
        <Clock size={14} className="text-muted" />
        <span className="tnum">{format(value, 'HH:mm')}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          <div ref={list} className="max-h-60 w-28 overflow-y-auto">
            {slots.map((m) => {
              const isCurrent = m <= minutes && minutes < m + 15
              return (
                <button
                  key={m}
                  type="button"
                  data-current={isCurrent}
                  onClick={() => {
                    const next = new Date(value)
                    next.setHours(Math.floor(m / 60), m % 60, 0, 0)
                    onChange(next.getTime())
                    setAnchor(null)
                  }}
                  className={`tnum flex h-8 w-full items-center rounded-md px-3 text-[13px] ${isCurrent ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'}`}
                >
                  {String(Math.floor(m / 60)).padStart(2, '0')}:{String(m % 60).padStart(2, '0')}
                </button>
              )
            })}
          </div>
        </Popover>
      )}
    </>
  )
}
