import { useEffect, useState } from 'react'
import { ChevronRight, Mail } from 'lucide-react'
import type { ImapAccountInput } from '@shared/types'
import { api, useStore } from '../store'
import { Label, Modal, fieldCls } from './Modal'

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

const EMPTY: ImapAccountInput = {
  name: '',
  email: '',
  username: '',
  password: '',
  imapHost: '',
  imapPort: 993,
  imapSecure: true,
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
  caldavUrl: null
}

export function AccountSetup() {
  const hasAccounts = useStore((s) => s.accounts.length > 0)
  const { setSetup, toast } = useStore.getState()
  const [step, setStep] = useState<'choose' | 'credentials' | 'servers'>('choose')
  const [form, setForm] = useState<ImapAccountInput>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [googleReady, setGoogleReady] = useState(true)
  const [detected, setDetected] = useState(false)

  useEffect(() => {
    void api.accounts.googleConfigured().then(setGoogleReady)
  }, [])

  const set = <K extends keyof ImapAccountInput>(k: K, v: ImapAccountInput[K]): void => setForm((f) => ({ ...f, [k]: v }))
  const close = (): void => setSetup(false)

  const done = (email: string): void => {
    toast(`${email} connecté. Première synchronisation en cours…`)
    close()
    useStore.getState().setView({ type: 'unified', role: 'inbox' })
  }

  const google = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const account = await api.accounts.addGoogle()
      done(account.email)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const discover = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const found = await api.accounts.discover(form.email.trim()).catch(() => null)
    const domain = form.email.split('@')[1] ?? ''
    setForm((f) => ({
      ...f,
      ...(found ?? { imapHost: `imap.${domain}`, imapPort: 993, imapSecure: true, smtpHost: `smtp.${domain}`, smtpPort: 465, smtpSecure: true, username: f.email }),
      username: found?.username ?? f.email
    }))
    setDetected(!!found)
    setBusy(false)
    setStep('servers')
  }

  const connect = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const account = await api.accounts.addImap(form)
      done(account.email)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const errorBox = error && <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>
  const primary = 'btn-primary h-9 rounded-md px-4 text-[13px] font-medium disabled:opacity-60'

  return (
    <Modal title={hasAccounts ? 'Ajouter un compte' : 'Bienvenue dans Mailbox'} onClose={close} closable={hasAccounts} width={480}>
      {step === 'choose' && (
        <div className="space-y-2 px-5 pb-5">
          {!hasAccounts && <p className="mb-4 text-[13px] text-muted">Connectez une première adresse. Vos messages restent sur votre machine et sur votre serveur, nulle part ailleurs.</p>}
          <button
            onClick={google}
            disabled={busy || !googleReady}
            className="flex h-12 w-full items-center gap-3 rounded-lg border border-line bg-panel px-4 text-left text-[13.5px] hover:border-line-strong hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleMark />
            <span className="flex-1">{busy ? 'En attente du navigateur…' : 'Gmail ou Google Workspace'}</span>
            <ChevronRight size={15} className="text-muted" />
          </button>
          {!googleReady && (
            <p className="px-1 text-[11.5px] text-muted">
              Connexion Google indisponible : renseignez MAIN_VITE_GOOGLE_CLIENT_ID et MAIN_VITE_GOOGLE_CLIENT_SECRET dans le fichier .env (voir README).
            </p>
          )}
          <button
            onClick={() => setStep('credentials')}
            className="flex h-12 w-full items-center gap-3 rounded-lg border border-line bg-panel px-4 text-left text-[13.5px] hover:border-line-strong hover:bg-hover"
          >
            <Mail size={18} strokeWidth={1.75} className="text-muted" />
            <span className="flex-1">Autre adresse (IMAP)</span>
            <ChevronRight size={15} className="text-muted" />
          </button>
          {errorBox}
          {!hasAccounts && (
            <button onClick={close} className="mt-2 w-full pt-2 text-center text-[12.5px] text-muted hover:text-fg">
              Passer pour l’instant (calendrier seul)
            </button>
          )}
        </div>
      )}

      {step === 'credentials' && (
        <form onSubmit={discover} className="space-y-3.5 px-5 pb-5">
          <Label text="Votre nom">
            <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldCls} placeholder="Camille Martin" />
          </Label>
          <Label text="Adresse e-mail">
            <input required type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={fieldCls} placeholder="camille@exemple.fr" />
          </Label>
          <Label text="Mot de passe" hint="Si votre fournisseur l’exige, utilisez un mot de passe d’application.">
            <input required type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className={fieldCls} />
          </Label>
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep('choose')} className="h-9 px-2 text-[13px] text-muted hover:text-fg">
              Retour
            </button>
            <button disabled={busy} className={primary}>
              {busy ? 'Recherche des serveurs…' : 'Continuer'}
            </button>
          </div>
        </form>
      )}

      {step === 'servers' && (
        <form onSubmit={connect} className="space-y-3.5 px-5 pb-5">
          <p className="text-[12.5px] text-muted">
            {detected ? 'Réglages trouvés automatiquement. Vérifiez-les puis connectez-vous.' : 'Réglages non trouvés automatiquement : voici une proposition, à corriger si besoin.'}
          </p>
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <Label text="Serveur IMAP">
              <input required value={form.imapHost} onChange={(e) => set('imapHost', e.target.value)} className={fieldCls} />
            </Label>
            <Label text="Port">
              <input required type="number" value={form.imapPort} onChange={(e) => {
                  const port = Number(e.target.value)
                  setForm((f) => ({ ...f, imapPort: port, imapSecure: port === 993 }))
                }} className={fieldCls} />
            </Label>
          </div>
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <Label text="Serveur SMTP">
              <input required value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} className={fieldCls} />
            </Label>
            <Label text="Port">
              <input
                required
                type="number"
                value={form.smtpPort}
                onChange={(e) => {
                  const port = Number(e.target.value)
                  setForm((f) => ({ ...f, smtpPort: port, smtpSecure: port === 465 }))
                }}
                className={fieldCls}
              />
            </Label>
          </div>
          <Label text="Identifiant">
            <input required value={form.username} onChange={(e) => set('username', e.target.value)} className={fieldCls} />
          </Label>
          <Label text="Agenda CalDAV (facultatif)" hint="Ex. https://nextcloud.exemple.fr/remote.php/dav — mêmes identifiants que la messagerie.">
            <input value={form.caldavUrl ?? ''} onChange={(e) => set('caldavUrl', e.target.value || null)} className={fieldCls} placeholder="https://" />
          </Label>
          {errorBox}
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep('credentials')} className="h-9 px-2 text-[13px] text-muted hover:text-fg">
              Retour
            </button>
            <button disabled={busy} className={primary}>
              {busy ? 'Connexion…' : 'Connecter le compte'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
