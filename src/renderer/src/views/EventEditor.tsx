import { useEffect, useState } from 'react'
import { MapPin, Repeat, Video } from 'lucide-react'
import type { Calendar, EventInput } from '@shared/types'
import { api, confirmDialog, useStore } from '../store'
import { Label, Modal, fieldCls } from '../components/Modal'
import { Select, Toggle } from '../components/ui/Controls'
import { DatePicker, TimePicker } from '../components/ui/DateTime'

export interface EditorState {
  id: string | null
  input: EventInput
  recurring?: boolean
  /** The event's existing video meeting, if any. */
  meetingUrl?: string | null
}

const DAY = 86_400_000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function EventEditor({
  state,
  calendars,
  onClose,
  onSaved
}: {
  state: EditorState
  calendars: Calendar[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useStore.getState()
  const [input, setInput] = useState<EventInput>(state.input)
  const [busy, setBusy] = useState(false)
  const current = calendars.find((c) => c.id === state.input.calendarId)
  const readOnly = !!current?.readOnly
  const choices = readOnly ? calendars.filter((c) => c.id === input.calendarId) : calendars.filter((c) => !c.readOnly)

  const set = <K extends keyof EventInput>(k: K, v: EventInput[K]): void => setInput((i) => ({ ...i, [k]: v }))
  // Meet rooms can only be created through Google's API: offer it on Google calendars.
  const [googleSources, setGoogleSources] = useState<Set<string> | null>(null)
  useEffect(() => {
    void api.calendar.sources().then((list) => setGoogleSources(new Set(list.filter((s) => s.kind === 'google').map((s) => s.id))))
  }, [])
  const chosen = calendars.find((c) => c.id === input.calendarId)
  const meetPossible = !!chosen && !!googleSources?.has(chosen.sourceId)

  // All-day events store an exclusive end (next midnight); the form shows the inclusive last day.
  const endShown = input.allDay ? input.end - DAY : input.end
  const invalid = input.end <= input.start

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (invalid) return
    setBusy(true)
    try {
      const toSave = { ...input, addMeet: !!input.addMeet && meetPossible }
      if (state.id) await api.calendar.update(state.id, toSave)
      else await api.calendar.create(toSave)
      toast(state.id ? 'Événement modifié' : 'Événement créé')
      onSaved()
    } catch (err) {
      toast((err as Error).message, 'error')
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!state.id) return
    const ok = await confirmDialog({
      title: state.recurring ? 'Supprimer toute la série ?' : 'Supprimer cet événement ?',
      body: state.recurring
        ? 'Cet événement se répète. Toutes ses occurrences seront supprimées de l’agenda.'
        : `« ${input.title || 'Sans titre'} » sera supprimé de l’agenda.`,
      confirmLabel: state.recurring ? 'Supprimer la série' : 'Supprimer',
      tone: 'danger'
    })
    if (!ok) return
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

  const setStart = (start: number): void => setInput((i) => ({ ...i, start, end: start + (i.end - i.start) }))

  return (
    <Modal title={state.id ? (readOnly ? 'Événement' : 'Modifier l’événement') : 'Nouvel événement'} onClose={onClose} width={480}>
      <form onSubmit={save} className="space-y-4 px-5 pb-5">
        <input
          autoFocus
          required
          disabled={readOnly}
          value={input.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Titre"
          className="h-11 w-full border-b border-line bg-transparent text-[17px] font-semibold tracking-[-0.01em] text-fg placeholder:text-faint focus:border-accent focus:outline-none"
        />

        {state.recurring && (
          <p className="flex items-center gap-2 text-[12.5px] text-muted">
            <Repeat size={13} /> Événement récurrent
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-10 text-[12.5px] text-muted">Début</span>
            <div className="flex-1">
              <DatePicker disabled={readOnly} value={input.start} onChange={setStart} />
            </div>
            {!input.allDay && (
              <div className="w-28">
                <TimePicker disabled={readOnly} value={input.start} onChange={setStart} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-10 text-[12.5px] text-muted">Fin</span>
            <div className="flex-1">
              <DatePicker disabled={readOnly} value={endShown} onChange={(v) => set('end', input.allDay ? startOfDay(v) + DAY : v)} />
            </div>
            {!input.allDay && (
              <div className="w-28">
                <TimePicker disabled={readOnly} value={input.end} onChange={(v) => set('end', v)} />
              </div>
            )}
          </div>
          {invalid && <p className="pl-12 text-[12px] text-danger">La fin doit être après le début.</p>}
          {!readOnly && (
            <div className="pl-12 pt-1">
              <Toggle
                label="Toute la journée"
                checked={input.allDay}
                onChange={(allDay) => {
                  const day = startOfDay(input.start)
                  setInput((i) =>
                    allDay
                      ? { ...i, allDay, start: day, end: Math.max(day + DAY, startOfDay(i.end - 1) + DAY) }
                      : { ...i, allDay, start: day + 9 * 3_600_000, end: day + 10 * 3_600_000 }
                  )
                }}
              />
            </div>
          )}
        </div>

        <Label text="Agenda">
          <Select
            ariaLabel="Agenda"
            disabled={readOnly}
            value={input.calendarId}
            onChange={(v) => set('calendarId', v)}
            options={choices.map((c) => ({ value: c.id, label: c.name, swatch: c.color }))}
            className="w-full"
          />
        </Label>
        <Label text="Lieu">
          <div className="relative">
            <MapPin size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              disabled={readOnly}
              value={input.location}
              onChange={(e) => set('location', e.target.value)}
              className={`${fieldCls} pl-9`}
              placeholder="Ajouter un lieu"
            />
          </div>
        </Label>
        {state.meetingUrl ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-[12.5px] text-fg-2">
            <Video size={15} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">Visio : {state.meetingUrl}</span>
          </div>
        ) : (
          !readOnly && (
            <div className={`flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 ${meetPossible ? '' : 'opacity-60'}`}>
              <Video size={16} className={`shrink-0 ${input.addMeet ? 'text-accent' : 'text-muted'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">Ajouter une visio Google Meet</p>
                <p className="text-[11.5px] text-muted">
                  {meetPossible
                    ? 'Le lien est créé à l’enregistrement, avec un bouton Rejoindre sur l’événement.'
                    : 'Disponible sur un agenda Google : choisissez-en un ci-dessus.'}
                </p>
              </div>
              <Toggle
                label=""
                ariaLabel="Ajouter une visio Google Meet"
                checked={!!input.addMeet && meetPossible}
                disabled={!meetPossible}
                onChange={(v) => set('addMeet', v)}
              />
            </div>
          )
        )}
        <Label text="Notes">
          <textarea
            disabled={readOnly}
            value={input.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            className={`${fieldCls} h-auto resize-none py-2`}
          />
        </Label>
        {readOnly ? (
          <p className="text-[12px] text-muted">Agenda en lecture seule.</p>
        ) : (
          <div className="flex items-center justify-between pt-1">
            {state.id ? (
              <button type="button" onClick={remove} disabled={busy} className="h-8 rounded-md px-2 text-[12.5px] text-danger hover:bg-danger/10">
                Supprimer
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-lg border border-line px-3.5 text-[13px] text-fg-2 hover:bg-hover hover:text-fg"
              >
                Annuler
              </button>
              <button disabled={busy || invalid} className="h-9 rounded-lg btn-primary px-4 text-[13px] font-medium disabled:opacity-50">
                {busy ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
