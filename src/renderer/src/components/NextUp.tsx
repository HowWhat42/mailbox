import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { MapPin, Video } from 'lucide-react'
import type { CalendarEvent } from '@shared/types'
import { api, useStore } from '../store'
import { join, joinable } from '../views/calendar/shared'

function when(e: CalendarEvent, now: number): string {
  if (now >= e.start) return `En cours · jusqu’à ${format(e.end, 'HH:mm')}`
  const min = Math.round((e.start - now) / 60_000)
  if (min < 60) return `Dans ${min} min`
  return new Date(e.start).toDateString() === new Date(now).toDateString()
    ? `Aujourd’hui à ${format(e.start, 'HH:mm')}`
    : `Demain à ${format(e.start, 'HH:mm')}`
}

/** "My day" card: the next meeting of the next 12 hours, with Join one click away. */
export function NextUp() {
  const [next, setNext] = useState<CalendarEvent | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const load = (): void => {
      setNow(Date.now())
      void api.calendar.upcoming(3).then((list) => setNext(list.find((e) => e.start - Date.now() < 12 * 3_600_000) ?? null))
    }
    load()
    const t = setInterval(load, 30_000)
    const off = api.app.on('calendar:changed', load)
    return () => {
      clearInterval(t)
      off()
    }
  }, [])

  if (!next) return null
  const soon = joinable(next, now)

  return (
    <div className={`mx-3 mb-2 rounded-xl border border-line p-3 ${soon ? 'lit' : 'bg-white/[0.02]'}`}>
      <button
        onClick={() => useStore.getState().focusEvent({ eventId: next.id, start: next.start })}
        className="block w-full min-w-0 text-left"
        title="Ouvrir dans le calendrier"
      >
        <span className={`block text-[11.5px] font-semibold ${soon ? 'text-accent' : 'text-muted'}`}>{when(next, now)}</span>
        <span className="mt-0.5 block truncate text-[13px] font-medium text-fg">{next.title || '(sans titre)'}</span>
        <span className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-muted">
          <span className="tnum">
            {format(next.start, 'HH:mm')} – {format(next.end, 'HH:mm')}
          </span>
          {(next.meetingProvider || next.location) && (
            <>
              ·{next.meetingProvider ? <Video size={11} /> : <MapPin size={11} />}
              <span className="truncate">{next.meetingProvider ?? next.location}</span>
            </>
          )}
        </span>
      </button>
      {next.meetingUrl && (
        <button
          onClick={() => join(next)}
          className={`mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-semibold ${soon ? 'btn-primary' : 'border border-line text-fg-2 hover:bg-hover hover:text-fg'}`}
        >
          <Video size={14} /> Rejoindre
        </button>
      )}
    </div>
  )
}
