import { useState } from 'react'
import type { Account } from '@shared/types'
import { api, useStore } from '../store'
import { Label, Modal, fieldCls } from './Modal'

const COLORS = ['#2dd4bf', '#818cf8', '#f472b6', '#fbbf24', '#60a5fa', '#a3e635', '#fb923c', '#f87171']

function AccountForm({ account }: { account: Account }) {
  const { toast } = useStore.getState()
  const [name, setName] = useState(account.name)
  const [signature, setSignature] = useState(account.signature)
  const [caldavUrl, setCaldavUrl] = useState(account.caldavUrl ?? '')
  const [color, setColor] = useState(account.color)
  const dirty = name !== account.name || signature !== account.signature || caldavUrl !== (account.caldavUrl ?? '') || color !== account.color

  const save = async (): Promise<void> => {
    await api.accounts.update(account.id, { name, signature, color, ...(account.kind === 'imap' ? { caldavUrl: caldavUrl.trim() || null } : {}) })
    toast('Compte enregistré')
  }

  const remove = async (): Promise<void> => {
    if (!window.confirm(`Retirer ${account.email} ? Les messages restent sur le serveur ; seule la copie locale est effacée.`)) return
    await api.accounts.remove(account.id)
    toast('Compte retiré')
  }

  return (
    <div className="space-y-3.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">{account.email}</div>
          <div className="text-[12px] text-muted">
            {account.kind === 'google' ? 'Google' : `IMAP · ${account.imapHost}`}
            {account.lastSyncAt && ` — synchronisé à ${new Date(account.lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
          </div>
        </div>
        <div className="flex gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Couleur ${c}`}
              className={`size-4 rounded-[4px] ${color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-raised' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      {account.syncError && <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{account.syncError}</p>}
      <Label text="Nom affiché aux destinataires">
        <input value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
      </Label>
      <Label text="Signature">
        <textarea value={signature} onChange={(e) => setSignature(e.target.value)} rows={3} className={`${fieldCls} h-auto py-2`} />
      </Label>
      {account.kind === 'imap' && (
        <Label text="Agenda CalDAV" hint="Laisser vide pour ne pas synchroniser d’agenda.">
          <input value={caldavUrl} onChange={(e) => setCaldavUrl(e.target.value)} className={fieldCls} placeholder="https://" />
        </Label>
      )}
      <div className="flex items-center justify-between">
        <button onClick={remove} className="h-8 text-[12.5px] text-danger hover:underline">
          Retirer ce compte
        </button>
        <button
          onClick={save}
          disabled={!dirty}
          className="h-8 rounded-md bg-accent px-3.5 text-[12.5px] font-medium text-accent-fg hover:brightness-110 disabled:opacity-40"
        >
          Enregistrer
        </button>
      </div>
    </div>
  )
}

export function Settings() {
  const accounts = useStore((s) => s.accounts)
  const { setSettings, setSetup } = useStore.getState()
  const [current, setCurrent] = useState(accounts[0]?.id ?? null)
  const account = accounts.find((a) => a.id === current) ?? accounts[0]

  return (
    <Modal title="Réglages" onClose={() => setSettings(false)} width={680}>
      <div className="flex min-h-[380px] border-t border-line">
        <div className="w-48 shrink-0 space-y-px border-r border-line p-2">
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setCurrent(a.id)}
              className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] ${a.id === account?.id ? 'bg-hover text-fg' : 'text-fg-2 hover:bg-hover/60'}`}
            >
              <span className="size-2 shrink-0 rounded-[3px]" style={{ background: a.color }} />
              <span className="truncate">{a.name}</span>
            </button>
          ))}
          <button
            onClick={() => {
              setSettings(false)
              setSetup(true)
            }}
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-[12.5px] text-muted hover:bg-hover/60 hover:text-fg"
          >
            Ajouter un compte…
          </button>
        </div>
        <div className="min-w-0 flex-1 p-5">
          {account ? <AccountForm key={account.id} account={account} /> : <p className="text-[13px] text-muted">Aucun compte configuré.</p>}
        </div>
      </div>
    </Modal>
  )
}
