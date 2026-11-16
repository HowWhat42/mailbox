import { useEffect, useState } from 'react'
import { addDays, addMonths, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Small month navigator: the selected range is highlighted, days with events get a dot. */
export function MiniMonth({ value, rangeStart, rangeEnd, busyDays, onPick }: { value: Date; rangeStart: Date; rangeEnd: Date; busyDays: Set<number>; onPick: (d: Date) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(value))
  useEffect(() => setMonth(startOfMonth(value)), [value])
  const first = startOfWeek(month, { weekStartsOn: 1 })
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i))

  return (
    <div className="px-1">
      <div className="mb-1 flex items-center">
        <span className="flex-1 pl-1.5 text-[12.5px] font-semibold capitalize">{format(month, 'MMMM yyyy', { locale: fr })}</span>
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Mois précédent" className="grid size-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <ChevronLeft size={14} />
        </button>
        <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Mois suivant" className="grid size-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10.5px] text-muted">
        {['l', 'm', 'm', 'j', 'v', 's', 'd'].map((d, i) => (
          <span key={i} className="pb-0.5">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const inRange = d >= rangeStart && d < rangeEnd
          return (
            <button
              key={d.getTime()}
              onClick={() => onPick(d)}
              className={`tnum relative mx-auto grid size-7 place-items-center rounded-md text-[11.5px] ${
                isToday(d)
                  ? 'btn-primary font-semibold'
                  : isSameDay(d, value)
                    ? 'lit text-fg'
                    : inRange
                      ? 'bg-accent-soft text-fg'
                      : isSameMonth(d, month)
                        ? 'text-fg-2 hover:bg-hover'
                        : 'text-faint hover:bg-hover'
              }`}
            >
              {format(d, 'd')}
              {busyDays.has(d.getTime()) && !isToday(d) && <span className="absolute bottom-0.5 size-[3px] rounded-full bg-accent" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
