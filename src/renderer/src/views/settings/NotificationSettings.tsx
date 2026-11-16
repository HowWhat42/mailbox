import { api, useStore } from '../../store'
import { Select, Toggle } from '../../components/ui/Controls'
import { minutesLabel, Row, Section, timeOfDay } from './parts'

const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30)

export function NotificationSettings() {
  const settings = useStore((s) => s.settings)!
  const accounts = useStore((s) => s.accounts)
  const update = useStore((s) => s.updateSettings)
  const openSettings = useStore((s) => s.openSettings)

  return (
    <>
      <Section title="Nouveaux messages">
        <Row label="Notifier les nouveaux messages">
          <Toggle label="" checked={settings.mailNotifications} onChange={(v) => void update({ mailNotifications: v })} />
        </Row>
        <Row label="Notifications intelligentes" hint="Seulement les messages de personnes et les invitations : ni newsletters ni notifications automatiques.">
          <Toggle label="" checked={settings.smartNotifications} onChange={(v) => void update({ smartNotifications: v })} />
        </Row>
        <Row label="Son">
          <Toggle label="" checked={settings.mailSound} onChange={(v) => void update({ mailSound: v })} />
        </Row>
        {accounts.length > 0 && (
          <Row label="Par compte" hint="Coupez les notifications d’une boîte sans toucher aux autres." stack>
            <div className="space-y-1.5">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5">
                  <span className="size-2.5 rounded-[3px]" style={{ background: a.color }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2">{a.email}</span>
                  <Toggle label="" checked={a.notify} onChange={(v) => void api.accounts.update(a.id, { notify: v })} />
                </div>
              ))}
            </div>
          </Row>
        )}
      </Section>

      <Section title="Heures calmes" description="Aucune notification de message pendant cette plage. Les rappels d’agenda restent actifs.">
        <Row label="Activer les heures calmes">
          <Toggle label="" checked={settings.quietHours} onChange={(v) => void update({ quietHours: v })} />
        </Row>
        {settings.quietHours && (
          <Row label="Plage">
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              de
              <Select
                ariaLabel="Début des heures calmes"
                className="w-24"
                value={String(settings.quietStart)}
                onChange={(v) => void update({ quietStart: Number(v) })}
                options={HALF_HOURS.map((m) => ({ value: String(m), label: timeOfDay(m) }))}
              />
              à
              <Select
                ariaLabel="Fin des heures calmes"
                className="w-24"
                value={String(settings.quietEnd)}
                onChange={(v) => void update({ quietEnd: Number(v) })}
                options={HALF_HOURS.map((m) => ({ value: String(m), label: timeOfDay(m) }))}
              />
            </div>
          </Row>
        )}
      </Section>

      <Section title="Rappels d’agenda" description="Affichés dans une fenêtre flottante au-dessus de vos autres applications.">
        <Row label="Rappel par défaut" hint="Pour les événements sans rappel défini.">
          <Select
            ariaLabel="Rappel par défaut"
            className="w-44"
            value={String(settings.reminderMinutes)}
            onChange={(v) => void update({ reminderMinutes: Number(v) })}
            options={[0, 5, 10, 15, 30, 60].map((m) => ({ value: String(m), label: minutesLabel(m) }))}
          />
        </Row>
        <Row label="Rappeler aussi au début des réunions en ligne" hint="Le moment où l’on a besoin du bouton Rejoindre.">
          <Toggle label="" checked={settings.reminderAtStart} onChange={(v) => void update({ reminderAtStart: v })} />
        </Row>
        <Row label="Son des rappels">
          <Toggle label="" checked={settings.reminderSound} onChange={(v) => void update({ reminderSound: v })} />
        </Row>
        <Row label="Par agenda" hint="Couper ou ajuster les rappels d’un agenda précis.">
          <button onClick={() => openSettings('calendars')} className="h-8 rounded-lg border border-line px-3 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg">
            Réglages des agendas
          </button>
        </Row>
      </Section>
    </>
  )
}
