import { useEffect, useState } from 'react'
import { CalendarPlus, ChevronRight, Link2, Server } from 'lucide-react'
import { api, useStore } from '../../store'
import { Label, Modal, fieldCls } from '../../components/Modal'

type Kind = 'choose' | 'caldav' | 'ics'

const CALDAV_PRESETS = [
  { label: 'iCloud', url: 'https://caldav.icloud.com', hint: 'Identifiant Apple + mot de passe pour app (appleid.apple.com).' },
  { label: 'Fastmail', url: 'https://caldav.fastmail.com', hint: 'Adresse Fastmail + mot de passe pour app.' },
  { label: 'Nextcloud', url: 'https://VOTRE-SERVEUR/remote.php/dav', hint: 'Remplacez VOTRE-SERVEUR par l’adresse de votre Nextcloud.' },
  { label: 'Infomaniak', url: 'https://sync.infomaniak.com', hint: 'Identifiant kSuite + mot de passe pour app.' }
]

/** Connect another calendar: Google, any CalDAV server, or a read-only .ics subscription. */
export function AddSourceDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useStore.getState()
  const [kind, setKind] = useState<Kind>('choose')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [googleReady, setGoogleReady] = useState(true)
  const [form, setForm] = useState({ name: '', url: '', username: '', password: '' })
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    void api.accounts.googleConfigured().then(setGoogleReady)
  }, [])

  const run = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      toast(done)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof typeof form, v: string): void => setForm((f) => ({ ...f, [k]: v }))
  const choice = 'flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left hover:border-line-strong hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50'
  const errorBox = error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger whitespace-pre-line">{error}</p>

  return (
    <Modal title="Ajouter un agenda" onClose={onClose} width={480}>
      {kind === 'choose' && (
        <div className="space-y-2 px-5 pb-5">
          <button
            disabled={busy || !googleReady}
            onClick={() => void run(() => api.calendar.addSource({ kind: 'google' }), 'Agendas Google connectés')}
            className={choice}
          >
            <CalendarPlus size={18} className="text-muted" />
            <span className="flex-1">
              <span className="block text-[13.5px] font-medium">{busy ? 'En attente du navigateur…' : 'Google Agenda'}</span>
              <span className="block text-[12px] text-muted">Tous les agendas d’un compte Google, en lecture et écriture.</span>
            </span>
            <ChevronRight size={15} className="text-muted" />
          </button>
          <button onClick={() => setKind('caldav')} className={choice}>
            <Server size={18} className="text-muted" />
            <span className="flex-1">
              <span className="block text-[13.5px] font-medium">CalDAV</span>
              <span className="block text-[12px] text-muted">iCloud, Nextcloud, Fastmail, Infomaniak, Zimbra…</span>
            </span>
            <ChevronRight size={15} className="text-muted" />
          </button>
          <button onClick={() => setKind('ics')} className={choice}>
            <Link2 size={18} className="text-muted" />
            <span className="flex-1">
              <span className="block text-[13.5px] font-medium">Abonnement par lien (.ics)</span>
              <span className="block text-[12px] text-muted">Agenda Outlook / Office 365 publié, jours fériés, planning partagé. Lecture seule.</span>
            </span>
            <ChevronRight size={15} className="text-muted" />
          </button>
          {!googleReady && <p className="px-1 text-[11.5px] text-muted">Google indisponible : client OAuth non configuré (voir README).</p>}
          {errorBox}
        </div>
      )}

      {kind === 'caldav' && (
        <form onSubmit={(e) => (e.preventDefault(), void run(() => api.calendar.addSource({ kind: 'caldav', ...form }), 'Agenda CalDAV connecté'))} className="space-y-3.5 px-5 pb-5">
          <div className="flex flex-wrap gap-1.5">
            {CALDAV_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setForm((f) => ({ ...f, url: p.url, name: f.name || p.label }))
                  setHint(p.hint)
                }}
                className={`h-7 rounded-lg border px-2.5 text-[12px] ${form.url === p.url ? 'lit border-transparent text-fg' : 'border-line text-fg-2 hover:bg-hover'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Label text="Adresse du serveur" hint={hint ?? 'L’adresse CalDAV fournie par votre hébergeur.'}>
            <input required autoFocus value={form.url} onChange={(e) => set('url', e.target.value)} className={fieldCls} placeholder="https://" />
          </Label>
          <Label text="Identifiant">
            <input required value={form.username} onChange={(e) => set('username', e.target.value)} className={fieldCls} placeholder="vous@exemple.fr" />
          </Label>
          <Label text="Mot de passe">
            <input required type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className={fieldCls} />
          </Label>
          <Label text="Nom affiché">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldCls} placeholder="Perso, Travail…" />
          </Label>
          {errorBox}
          <div className="flex justify-between pt-1">
            <button type="button" onClick={() => setKind('choose')} className="h-9 px-2 text-[13px] text-muted hover:text-fg">
              Retour
            </button>
            <button disabled={busy} className="btn-primary h-9 rounded-lg px-4 text-[13px] font-medium disabled:opacity-60">
              {busy ? 'Connexion…' : 'Connecter'}
            </button>
          </div>
        </form>
      )}

      {kind === 'ics' && (
        <form onSubmit={(e) => (e.preventDefault(), void run(() => api.calendar.addSource({ kind: 'ics', name: form.name, url: form.url }), 'Abonnement ajouté'))} className="space-y-3.5 px-5 pb-5">
          <Label
            text="Lien de l’agenda"
            hint="Outlook : Paramètres › Calendrier › Calendriers partagés › Publier un calendrier, puis copiez le lien ICS. Les liens webcal:// fonctionnent aussi."
          >
            <input required autoFocus value={form.url} onChange={(e) => set('url', e.target.value)} className={fieldCls} placeholder="https://… .ics" />
          </Label>
          <Label text="Nom affiché">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldCls} placeholder="Agenda Outlook, Jours fériés…" />
          </Label>
          {errorBox}
          <div className="flex justify-between pt-1">
            <button type="button" onClick={() => setKind('choose')} className="h-9 px-2 text-[13px] text-muted hover:text-fg">
              Retour
            </button>
            <button disabled={busy} className="btn-primary h-9 rounded-lg px-4 text-[13px] font-medium disabled:opacity-60">
              {busy ? 'Vérification…' : 'S’abonner'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
