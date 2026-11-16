import { useCallback, useEffect, useState } from 'react'
import { Globe, Link2, Plus, Server } from 'lucide-react'
import type { Calendar, CalendarSource } from '@shared/types'
import { api, confirmDialog, useStore } from '../../store'
import { Select, Toggle } from '../../components/ui/Controls'
import { AddSourceDialog } from '../calendar/AddSourceDialog'
import { minutesLabel, Section } from './parts'

const ICON = { google: Globe, caldav: Server, ics: Link2 }
const KIND = { google: 'Google Agenda', caldav: 'CalDAV', ics: 'Abonnement (lecture seule)' }
const SWATCHES = ['#8f86f0', '#5b8cff', '#38bdf8', '#2dd4bf', '#4ade80', '#f5b041', '#fb7c5c', '#f87171', '#f472b6', '#c084fc']

function CalendarRow({ c, onChange }: { c: Calendar; onChange: () => void }) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setPicking(!picking)}
          aria-label={`Couleur de ${c.name}`}
          className="size-4 shrink-0 rounded-full ring-offset-2 ring-offset-[var(--surface-solid)] hover:ring-2 hover:ring-line-strong"
          style={{ background: c.color }}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {c.name}
          {c.readOnly && <span className="ml-2 text-[11.5px] font-normal text-muted">lecture seule</span>}
        </span>
        <span className="text-[12px] text-muted">Afficher</span>
        <Toggle label="" checked={c.enabled} onChange={(v) => void api.calendar.setEnabled(c.id, v).then(onChange)} />
        <span className="text-[12px] text-muted">Rappels</span>
        <Toggle label="" checked={c.notify} onChange={(v) => void api.calendar.setCalendarPrefs(c.id, { notify: v }).then(onChange)} />
        <Select
          ariaLabel={`Rappel pour ${c.name}`}
          className="w-48"
          disabled={!c.notify}
          value={c.reminderOverride == null ? 'auto' : String(c.reminderOverride)}
          onChange={(v) => void api.calendar.setCalendarPrefs(c.id, { reminderOverride: v === 'auto' ? null : Number(v) }).then(onChange)}
          options={[
            { value: 'auto', label: 'Rappels de l’événement' },
            ...[0, 5, 10, 15, 30, 60, 1440].map((m) => ({ value: String(m), label: minutesLabel(m) }))
          ]}
        />
      </div>
      {picking && (
        <div className="flex flex-wrap gap-1.5 pl-7">
          {SWATCHES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setPicking(false)
                void api.calendar.setCalendarColor(c.id, s).then(onChange)
              }}
              aria-label={`Couleur ${s}`}
              className={`size-5 rounded-full ${s === c.color ? 'ring-2 ring-fg ring-offset-2 ring-offset-[var(--surface-solid)]' : ''}`}
              style={{ background: s }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CalendarSettings() {
  const accounts = useStore((s) => s.accounts)
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    void Promise.all([api.calendar.sources(), api.calendar.calendars()]).then(([s, c]) => {
      setSources(s)
      setCalendars(c)
    })
  }, [])
  useEffect(() => {
    load()
    return api.app.on('calendar:changed', load)
  }, [load])

  return (
    <>
      {sources.length === 0 && (
        <Section title="Agendas" description="Aucun agenda connecté pour l’instant.">
          <div className="px-4 py-4 text-[12.5px] text-muted">Google, iCloud, Nextcloud, Fastmail ou un lien Outlook publié.</div>
        </Section>
      )}
      {sources.map((s) => {
        const Icon = ICON[s.kind]
        const linked = accounts.find((a) => a.id === s.accountId)
        return (
          <Section
            key={s.id}
            title={s.name}
            description={`${KIND[s.kind]}${linked ? ` · via le compte ${linked.email}` : ''}${s.syncError ? ` · erreur : ${s.syncError}` : ''}`}
          >
            {calendars
              .filter((c) => c.sourceId === s.id)
              .map((c) => (
                <CalendarRow key={c.id} c={c} onChange={load} />
              ))}
            <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-muted">
              <Icon size={13} />
              <span className="flex-1">
                {s.lastSyncAt
                  ? `Actualisé à ${new Date(s.lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                  : 'Jamais actualisé'}
              </span>
              {!s.accountId && (
                <button
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: `Retirer « ${s.name} » ?`,
                      body: 'Rien n’est supprimé sur le serveur.',
                      confirmLabel: 'Retirer',
                      tone: 'danger'
                    })
                    if (ok) {
                      await api.calendar.removeSource(s.id)
                      load()
                    }
                  }}
                  className="h-7 rounded-md px-2 text-[12px] text-danger hover:bg-danger/10"
                >
                  Retirer
                </button>
              )}
            </div>
          </Section>
        )
      })}
      <button onClick={() => setAdding(true)} className="btn-primary flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-medium">
        <Plus size={15} /> Ajouter un agenda
      </button>
      {adding && (
        <AddSourceDialog
          onClose={() => {
            setAdding(false)
            load()
          }}
        />
      )}
    </>
  )
}
