import { useState } from 'react'
import { Check, CircleHelp, Clock, ExternalLink, MapPin, Pencil, Repeat, Trash2, Users, Video, X } from 'lucide-react'
import type { Calendar, CalendarEvent, ResponseStatus } from '@shared/types'
import { api, confirmDialog, useStore } from '../../store'
import { Popover, type Anchor } from '../../components/ui/Popover'
import { Avatar } from '../../components/Avatar'
import { RichText } from '../../lib/linkify'
import { join, joinable, STATUS_LABEL, timeRange } from './shared'

const STATUS_ICON: Record<ResponseStatus, { icon: typeof Check; cls: string }> = {
  accepted: { icon: Check, cls: 'text-emerald-400' },
  tentative: { icon: CircleHelp, cls: 'text-amber-400' },
  declined: { icon: X, cls: 'text-danger' },
  needsAction: { icon: Clock, cls: 'text-muted' }
}

/** Outlook-style quick view of an event: join, answer, edit, delete without opening a form. */
export function EventPeek({
  event,
  calendar,
  anchor,
  onClose,
  onEdit,
  onChanged
}: {
  event: CalendarEvent
  calendar: Calendar | undefined
  anchor: Anchor
  onClose: () => void
  onEdit: () => void
  onChanged: () => void
}) {
  const { toast } = useStore.getState()
  const [busy, setBusy] = useState<ResponseStatus | 'delete' | null>(null)
  const readOnly = !calendar || calendar.readOnly
  const color = calendar?.color ?? 'var(--accent)'
  const people = event.attendees.toSorted((a, b) => Number(b.organizer) - Number(a.organizer))

  const respond = async (status: Exclude<ResponseStatus, 'needsAction'>): Promise<void> => {
    setBusy(status)
    try {
      await api.calendar.respond(event.id, status)
      toast(status === 'accepted' ? 'Invitation acceptée' : status === 'declined' ? 'Invitation refusée' : 'Réponse provisoire envoyée')
      onChanged()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: event.recurring ? 'Supprimer toute la série ?' : 'Supprimer cet événement ?',
      body: event.recurring ? 'Cet événement se répète : toutes ses occurrences seront supprimées.' : `« ${event.title || 'Sans titre'} » sera supprimé de l’agenda.`,
      confirmLabel: event.recurring ? 'Supprimer la série' : 'Supprimer',
      tone: 'danger'
    })
    if (!ok) return
    setBusy('delete')
    try {
      await api.calendar.remove(event.id)
      toast('Événement supprimé')
      onClose()
      onChanged()
    } catch (err) {
      toast((err as Error).message, 'error')
      setBusy(null)
    }
  }

  const iconBtn = 'grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-40'

  return (
    <Popover anchor={anchor} onClose={onClose} className="!p-0">
      <div role="dialog" aria-label={event.title} className="w-[min(400px,calc(100vw-24px))]">
        <div className="flex items-center gap-1 px-3 pt-2">
          <span className="ml-1 size-2.5 rounded-[3px]" style={{ background: color }} />
          <span className="min-w-0 flex-1 truncate pl-1 text-[12px] text-muted">{calendar?.name}</span>
          {event.webLink && (
            <button onClick={() => void api.app.openExternal(event.webLink!)} title="Ouvrir dans le navigateur" aria-label="Ouvrir dans le navigateur" className={iconBtn}>
              <ExternalLink size={14} />
            </button>
          )}
          {!readOnly && (
            <>
              <button onClick={onEdit} title="Modifier" aria-label="Modifier" className={iconBtn}>
                <Pencil size={14} />
              </button>
              <button onClick={() => void remove()} disabled={busy === 'delete'} title="Supprimer" aria-label="Supprimer l’événement" className={`${iconBtn} hover:!text-danger`}>
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button onClick={onClose} aria-label="Fermer" className={iconBtn}>
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[min(70vh,560px)] space-y-3.5 overflow-y-auto px-4 pb-4 pt-1">
          <div>
            <h2 className="text-[17px] font-semibold leading-snug tracking-[-0.01em] select-text">{event.title || '(sans titre)'}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] capitalize text-fg-2">
              {timeRange(event)}
              {event.recurring && <Repeat size={12} className="text-muted" aria-label="Récurrent" />}
            </p>
          </div>

          {event.meetingUrl && (
            <button
              onClick={() => {
                join(event)
                onClose()
              }}
              className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold ${joinable(event) ? 'btn-primary' : 'border border-line-strong bg-hover text-fg hover:brightness-125'}`}
            >
              <Video size={16} /> Rejoindre {event.meetingProvider ? `avec ${event.meetingProvider}` : 'la réunion'}
            </button>
          )}

          {event.myStatus && (
            <div>
              <p className="mb-1.5 text-[12px] text-muted">
                Votre réponse : <span className="text-fg-2">{STATUS_LABEL[event.myStatus]}</span>
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {(['accepted', 'tentative', 'declined'] as const).map((s) => (
                  <button
                    key={s}
                    disabled={!!busy}
                    onClick={() => void respond(s)}
                    className={`h-8 rounded-lg text-[12.5px] font-medium disabled:opacity-60 ${
                      event.myStatus === s ? 'lit text-fg' : 'border border-line text-fg-2 hover:bg-hover hover:text-fg'
                    }`}
                  >
                    {busy === s ? '…' : s === 'accepted' ? 'Accepter' : s === 'tentative' ? 'Provisoire' : 'Refuser'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {event.location && !(event.meetingUrl && event.location.includes(event.meetingUrl)) && (
            <p className="flex items-start gap-2 text-[12.5px] text-fg-2 select-text">
              <MapPin size={14} className="mt-0.5 shrink-0 text-muted" />
              {event.location}
            </p>
          )}

          {people.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted">
                <Users size={13} /> {people.length} participant{people.length > 1 ? 's' : ''} ·{' '}
                {people.filter((p) => p.status === 'accepted').length} oui · {people.filter((p) => p.status === 'declined').length} non
              </p>
              <div className="space-y-0.5">
                {people.slice(0, 12).map((p) => {
                  const S = STATUS_ICON[p.status]
                  return (
                    <div key={p.email} className="flex items-center gap-2.5 rounded-md py-1" title={`${p.email} — ${STATUS_LABEL[p.status]}`}>
                      <span className="relative">
                        <Avatar name={p.name || p.email} seed={p.email} size={26} />
                        <span className="absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-raised">
                          <S.icon size={10} strokeWidth={3} className={S.cls} />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {p.name || p.email}
                        {p.self && <span className="text-muted"> (vous)</span>}
                      </span>
                      {p.organizer && <span className="text-[11px] text-muted">Organisateur</span>}
                    </div>
                  )
                })}
                {people.length > 12 && <p className="text-[12px] text-muted">et {people.length - 12} autres</p>}
              </div>
            </div>
          )}

          {event.description.trim() && <RichText text={event.description} className="max-h-48 overflow-y-auto border-t border-line pt-3 text-[12.5px] leading-relaxed text-fg-2 select-text" />}
        </div>
      </div>
    </Popover>
  )
}
