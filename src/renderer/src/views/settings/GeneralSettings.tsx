import { useEffect, useState } from 'react'
import { CircleCheck, CircleDashed } from 'lucide-react'
import { api, useStore } from '../../store'
import { Select, Toggle } from '../../components/ui/Controls'
import { Row, Section, Segmented } from './parts'

export function GeneralSettings() {
  const settings = useStore((s) => s.settings)!
  const update = useStore((s) => s.updateSettings)
  const [login, setLogin] = useState<{ enabled: boolean; packaged: boolean } | null>(null)

  // Ask the OS again after each change to the start-up settings.
  useEffect(() => {
    void api.settings.loginItem().then(setLogin)
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- re-running on this change is the point
  }, [settings.launchAtLogin, settings.startHidden])

  return (
    <>
      <Section
        title="Démarrage"
        description="Mailbox peut se lancer avec Windows et rester discret dans la barre des tâches, pour que les rappels et les nouveaux messages arrivent même fenêtre fermée."
      >
        <Row
          label="Lancer Mailbox au démarrage de Windows"
          hint={
            login && (
              <span className="flex items-center gap-1.5">
                {login.enabled ? <CircleCheck size={12} className="text-emerald-400" /> : <CircleDashed size={12} />}
                {login.enabled ? 'Enregistré auprès de Windows.' : 'Pas lancé au démarrage.'}
                {!login.packaged && login.enabled && ' (version de développement)'}
              </span>
            )
          }
        >
          <Toggle label="" checked={settings.launchAtLogin} onChange={(v) => void update({ launchAtLogin: v })} />
        </Row>
        <Row label="Démarrer réduit dans la barre des tâches" hint="Au démarrage de la session, sans ouvrir la fenêtre.">
          <Toggle label="" checked={settings.startHidden} onChange={(v) => void update({ startHidden: v })} />
        </Row>
        <Row label="Rester actif quand la fenêtre est fermée" hint="Sinon, fermer la fenêtre quitte Mailbox et coupe les rappels.">
          <Toggle label="" checked={settings.backgroundMode} onChange={(v) => void update({ backgroundMode: v })} />
        </Row>
      </Section>

      <Section title="Lecture">
        <Row label="Marquer comme lu" hint="Quand une conversation ouverte passe en lu.">
          <Select
            ariaLabel="Marquer comme lu"
            className="w-56"
            value={String(settings.markReadDelay)}
            onChange={(v) => void update({ markReadDelay: Number(v) })}
            options={[
              { value: '0', label: 'Dès l’ouverture' },
              { value: '2000', label: 'Après 2 secondes' },
              { value: '5000', label: 'Après 5 secondes' },
              { value: '-1', label: 'Jamais automatiquement' }
            ]}
          />
        </Row>
        <Row label="Images distantes" hint="Les bloquer empêche les pixels espions de savoir quand vous lisez un message.">
          <Segmented
            ariaLabel="Images distantes"
            value={settings.remoteImages}
            onChange={(v) => void update({ remoteImages: v })}
            options={[
              { value: 'block', label: 'Bloquer' },
              { value: 'allow', label: 'Afficher' }
            ]}
          />
        </Row>
        <Row label="Délai pour annuler" hint="Archiver, supprimer ou abandonner un brouillon reste annulable (touche Z) pendant ce temps.">
          <Select
            ariaLabel="Délai pour annuler"
            className="w-40"
            value={String(settings.undoSeconds)}
            onChange={(v) => void update({ undoSeconds: Number(v) })}
            options={[5, 10, 20, 30].map((n) => ({ value: String(n), label: `${n} secondes` }))}
          />
        </Row>
      </Section>
    </>
  )
}
