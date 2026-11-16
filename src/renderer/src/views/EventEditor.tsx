import { useState } from 'react'
import { format } from 'date-fns'
import type { Calendar, EventInput } from '@shared/types'
import { api, useStore } from '../store'
import { Label, Modal, fieldCls } from '../components/Modal'

export interface EditorState {
  id: string | null
  input: EventInput
  recurring?: boolean
}

const DAY = 86_400_000

function toLocal(ts: number, allDay: boolean): string {
  return format(ts, allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm")
}

function fromLocal(value: string): number {
  // "yyyy-MM-dd" alone would parse as UTC; force local midnight.
  return new Date(value.length === 10 ? `${value}T00:00` : value).getTime()
}

export function EventEditor({ state, calendars, onClose, onSaved }: { state: EditorState; calendars: Calendar[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useStore.getState()
  const [input, setInput] = useState<EventInput>(state.input)
  const [busy, setBusy] = useState(false)
  const current = calendars.find((c) => c.id === state.input.calendarId)
  const readOnly = !!current?.readOnly
  const choices = calendars.filter((c) => !c.readOnly)

  const set = <K extends keyof EventInput>(k: K, v: EventInput[K]): void => setInput((i) => ({ ...i, [k]: v }))

  // All-day events store an exclusive end (next midnight); the form shows the inclusive last day.
  const endShown = input.allDay ? input.end - DAY : input.end

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (input.end <= input.start) {
      toast('La fin doit être après le début.', 'error')
      return
    }
    setBusy(true)
    try {
      if (state.id) await api.calendar.update(state.id, input)
      else await api.calendar.create(input)
      toast(state.id ? 'Événement modifié' : 'Événement créé')
      onSaved()
    } catch (err) {
      toast((err as Error).message, 'error')
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!state.id) return
    const question = state.recurring ? 'Supprimer cet événement récurrent ? Toute la série sera supprimée.' : 'Supprimer cet événement ?'
    if (!window.confirm(question)) return
    setBusy(true)
    try {
      await api.calendar.remove(state.id)
      toast('Événement supprimé')
      onSaved()
    } catch (err) {
      toast((err as Error).message, 'error')
      setBusy(false)
    }
  }

  return (
    <Modal title={state.id ? (readOnly ? 'Événement' : 'Modifier l’événement') : 'Nouvel événement'} onClose={onClose} width={460}>
      <form onSubmit={save} className="space-y-3.5 px-5 pb-5">
        <input
          autoFocus
          required
          disabled={readOnly}
          value={input.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Titre"
          className="h-10 w-full border-b border-line bg-transparent text-[16px] font-medium text-fg placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <label className="flex items-center gap-2 text-[12.5px] text-fg-2">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={input.allDay}
            onChange={(e) => {
              const allDay = e.target.checked
              const day = new Date(input.start)
              day.setHours(0, 0, 0, 0)
              setInput((i) =>
                allDay
                  ? { ...i, allDay, start: day.getTime(), end: day.getTime() + DAY }
                  : { ...i, allDay, start: day.getTime() + 9 * 3_600_000, end: day.getTime() + 10 * 3_600_000 }
              )
            }}
            className="accent-[var(--accent)]"
          />
          Toute la journée
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Label text="Début">
            <input
              type={input.allDay ? 'date' : 'datetime-local'}
              disabled={readOnly}
              value={toLocal(input.start, input.allDay)}
              onChange={(e) => {
                const start = fromLocal(e.target.value)
                if (Number.isNaN(start)) return
                // Moving the start keeps the duration.
                setInput((i) => ({ ...i, start, end: start + (i.end - i.start) }))
              }}
              className={fieldCls}
            />
          </Label>
          <Label text="Fin">
            <input
              type={input.allDay ? 'date' : 'datetime-local'}
              disabled={readOnly}
              value={toLocal(endShown, input.allDay)}
              onChange={(e) => {
                const v = fromLocal(e.target.value)
                if (!Number.isNaN(v)) set('end', input.allDay ? v + DAY : v)
              }}
              className={fieldCls}
            />
          </Label>
        </div>
        <Label text="Agenda">
          <select disabled={readOnly} value={input.calendarId} onChange={(e) => set('calendarId', e.target.value)} className={fieldCls}>
            {(readOnly ? calendars.filter((c) => c.id === input.calendarId) : choices).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Lieu">
          <input disabled={readOnly} value={input.location} onChange={(e) => set('location', e.target.value)} className={fieldCls} />
        </Label>
        <Label text="Notes">
          <textarea disabled={readOnly} value={input.description} onChange={(e) => set('description', e.target.value)} rows={3} className={`${fieldCls} h-auto py-2`} />
        </Label>
        {!readOnly && (
          <div className="flex items-center justify-between pt-1">
            {state.id ? (
              <button type="button" onClick={remove} disabled={busy} className="h-8 text-[12.5px] text-danger hover:underline">
                Supprimer
              </button>
            ) : (
              <span />
            )}
            <button disabled={busy} className="h-9 rounded-md bg-accent px-4 text-[13px] font-medium text-accent-fg hover:brightness-110 disabled:opacity-60">
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        )}
      </form>
    </Modal>
  )
}
