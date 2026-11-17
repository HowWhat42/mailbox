import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { format } from 'date-fns'
import { AlarmClock, MapPin, Video, X } from 'lucide-react'
import type { Reminder } from '@shared/types'
import './styles.css'
import { applyAppearance } from './lib/appearance'

const api = window.mailbox

function relative(start: number, now: number): string {
  const min = Math.round((start - now) / 60_000)
  if (min > 0) return min === 1 ? 'Dans 1 min' : min < 60 ? `Dans ${min} min` : `À ${format(start, 'HH:mm')}`
  if (min === 0) return 'Maintenant'
  return `A commencé il y a ${-min} min`
}

/** Two soft notes, generated (no audio file to ship). */
function chime(): void {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    for (const [i, freq] of [880, 1318.5].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + i * 0.14)
      gain.gain.linearRampToValueAtTime(0.12, now + i * 0.14 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.6)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.14)
      osc.stop(now + i * 0.14 + 0.65)
    }
    setTimeout(() => void ctx.close(), 1200)
  } catch {
    // No audio device: stay silent.
  }
}

function Card({ r, now }: { r: Reminder; now: number }) {
  const untilStart = r.start - now
  const startingSoon = untilStart <= 60_000
  return (
    <article
      className="pop-in glass relative flex h-[132px] shrink-0 flex-col overflow-hidden rounded-2xl border border-line pl-5 pr-3 pt-3"
      style={{
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.06), 0 18px 40px -18px rgb(0 0 0 / 0.9), inset 0 -18px 28px -22px rgb(120 100 255 / 0.55)'
      }}
    >
      <span className="absolute inset-y-3 left-2 w-[3px] rounded-full" style={{ background: r.color }} />
      <div className="flex items-center gap-2 text-[11.5px]">
        <span className={`font-semibold ${startingSoon ? 'text-accent' : 'text-fg-2'}`}>{relative(r.start, now)}</span>
        <span className="truncate text-muted">· {r.calendarName}</span>
        <button
          onClick={() => void api.reminders.dismiss(r.key)}
          aria-label="Ignorer"
          title="Ignorer"
          className="ml-auto grid size-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <button onClick={() => void api.reminders.open(r.key)} className="min-w-0 text-left" title="Ouvrir dans le calendrier">
        <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{r.title}</h1>
        <p className="flex items-center gap-1.5 truncate text-[12px] text-muted">
          <span className="tnum">
            {format(r.start, 'HH:mm')} – {format(r.end, 'HH:mm')}
          </span>
          {(r.meetingProvider || r.location) && (
            <>
              <span>·</span>
              {r.meetingProvider ? <Video size={12} /> : <MapPin size={12} />}
              <span className="truncate">{r.meetingProvider ?? r.location}</span>
            </>
          )}
        </p>
      </button>
      <div className="mt-auto flex items-center gap-1.5 pb-3">
        {r.meetingUrl && (
          <button
            onClick={() => void api.reminders.join(r.key)}
            className="btn-primary flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold"
          >
            <Video size={14} /> Rejoindre
          </button>
        )}
        <button
          onClick={() => void api.reminders.snooze(r.key, 5)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
        >
          <AlarmClock size={13} /> 5 min
        </button>
        {untilStart > 15 * 60_000 ? (
          <button
            onClick={() => void api.reminders.snooze(r.key, 15)}
            className="h-8 rounded-lg border border-line px-2.5 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
          >
            15 min
          </button>
        ) : (
          untilStart > 60_000 && (
            // Closer than 15 min, "15 min" would land after the start: remind right when it begins instead.
            <button
              onClick={() => void api.reminders.snooze(r.key, (r.start - Date.now()) / 60_000)}
              className="h-8 rounded-lg border border-line px-2.5 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
            >
              Au début
            </button>
          )
        )}
        <button
          onClick={() => void api.reminders.dismiss(r.key)}
          className="ml-auto h-8 rounded-lg px-2.5 text-[12.5px] text-muted hover:bg-hover hover:text-fg"
        >
          Ignorer
        </button>
      </div>
    </article>
  )
}

function Stack() {
  const [items, setItems] = useState<Reminder[]>([])
  const [now, setNow] = useState(() => Date.now())
  const seen = useRef(new Set<string>())

  useEffect(() => {
    const load = async (): Promise<void> => {
      const [list, settings] = await Promise.all([api.reminders.list(), api.settings.get()])
      // The floating card always uses the night look, in the user's accent.
      applyAppearance({ ...settings, theme: 'dark', backdrop: 'plain' })
      const fresh = list.some((r) => !seen.current.has(r.key))
      for (const r of list) seen.current.add(r.key)
      setItems(list)
      if (fresh && settings.reminderSound) chime()
    }
    void load()
    const off = api.app.on('reminders:changed', () => void load())
    const offSettings = api.app.on('settings:changed', (s) => applyAppearance({ ...s, theme: 'dark', backdrop: 'plain' }))
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => {
      off()
      offSettings()
      clearInterval(t)
    }
  }, [])

  return (
    <div className="flex h-screen flex-col justify-end gap-[10px] overflow-hidden p-4">
      {items.slice(0, 4).map((r) => (
        <Card key={r.key} r={r} now={now} />
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Stack />
  </StrictMode>
)
