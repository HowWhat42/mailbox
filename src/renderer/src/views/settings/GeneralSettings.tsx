import { useEffect, useState } from 'react'
import { CircleCheck, CircleDashed, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import type { UpdateStatus } from '@shared/types'
import { api, useStore } from '../../store'
import { Select, Toggle } from '../../components/ui/Controls'
import { Row, Section, Segmented } from './parts'

function updateHint(u: UpdateStatus): string {
  switch (u.state) {
    case 'unsupported':
      return 'Version de développement : pas de mise à jour automatique.'
    case 'idle':
      return 'Recherche automatique au démarrage, puis toutes les 4 heures.'
    case 'checking':
      return 'Recherche en cours…'
    case 'latest':
      return `Vous avez la dernière version${u.checkedAt ? ` · vérifié à ${format(u.checkedAt, 'HH:mm')}` : ''}.`
    case 'downloading':
      return `Téléchargement de la version ${u.available} · ${u.percent ?? 0} %`
    case 'ready':
      return u.manual
        ? `La version ${u.available} est disponible : téléchargez-la, puis remplacez Mailbox dans Applications.`
        : `La version ${u.available} est prête. Elle s’installera au prochain redémarrage de Mailbox.`
    case 'error':
      return u.error ?? 'La recherche de mise à jour a échoué.'
  }
}

function UpdatesSection() {
  const update = useStore((s) => s.update)
  const setNotesOpen = useStore((s) => s.setNotesOpen)
  if (!update) return null
  const busy = update.state === 'checking' || update.state === 'downloading'
  return (
    <Section title="Mises à jour" description="Les nouvelles versions se téléchargent en arrière-plan ; un redémarrage suffit pour les installer.">
      <Row
        label={`Mailbox ${update.current}`}
        hint={
          <>
            {updateHint(update)}
            {!!update.notes?.length && (update.state === 'ready' || update.state === 'downloading') && (
              <button onClick={() => setNotesOpen(true)} className="ml-1.5 font-medium text-accent hover:underline">
                Voir les nouveautés
              </button>
            )}
          </>
        }
      >
        {update.state === 'ready' ? (
          <button onClick={() => void api.updates.install()} className="btn-primary h-8 rounded-lg px-3.5 text-[12.5px] font-medium">
            {update.manual ? 'Télécharger' : 'Redémarrer maintenant'}
          </button>
        ) : (
          <button
            disabled={busy || update.state === 'unsupported'}
            onClick={() => void api.updates.check()}
            className="flex h-8 items-center gap-2 rounded-lg border border-line px-3.5 text-[12.5px] text-fg-2 hover:border-line-strong hover:text-fg disabled:opacity-50"
          >
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Rechercher
          </button>
        )}
      </Row>
    </Section>
  )
}

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

      <UpdatesSection />
    </>
  )
}
