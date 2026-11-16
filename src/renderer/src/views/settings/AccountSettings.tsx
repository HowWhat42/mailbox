import { useCallback, useEffect, useState } from 'react'
import { FileText, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { Account, MailTemplate, MailTemplateInput } from '@shared/types'
import { api, confirmDialog, useStore } from '../../store'
import { Select, Toggle } from '../../components/ui/Controls'
import { fieldCls } from '../../components/Modal'
import { Row, Section } from './parts'
import { MarkerSample } from './MarkerPicker'
import { accountLabel } from '../../lib/accounts'
import { isHtmlSignature, signatureHtml } from '../../lib/signature'
import { templateFields } from '../../lib/templates'
import { HtmlPreview } from '../../components/HtmlPreview'
import { ColorPicker } from '../../components/ui/ColorPicker'
import { TemplateEditor } from '../../components/TemplateEditor'

const COLORS = ['#8f86f0', '#5b8cff', '#38bdf8', '#2dd4bf', '#4ade80', '#a3e635', '#f5b041', '#fb7c5c', '#f87171', '#f472b6', '#c084fc', '#94a3b8']

/** Settings of one mailbox: identity, signature, notifications, sync, calendar. */
export function AccountSettings({ account }: { account: Account }) {
  const { toast, openSettings } = useStore.getState()
  const [name, setName] = useState(account.name)
  const [signature, setSignature] = useState(account.signature)
  const [caldavUrl, setCaldavUrl] = useState(account.caldavUrl ?? '')
  const [label, setLabel] = useState(account.label)
  const marker = useStore((s) => s.settings?.accountMarker ?? 'stripe')

  const dirty = name !== account.name || signature !== account.signature || caldavUrl !== (account.caldavUrl ?? '')
  const patch = (p: Parameters<typeof api.accounts.update>[1]): void => void api.accounts.update(account.id, p)

  const save = async (): Promise<void> => {
    await api.accounts.update(account.id, { name, signature, ...(account.kind === 'imap' ? { caldavUrl: caldavUrl.trim() || null } : {}) })
    toast('Compte enregistré')
  }

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: `Retirer ${account.email} ?`,
      body: 'Les messages et agendas restent sur le serveur ; seule la copie locale est effacée de cet ordinateur.',
      confirmLabel: 'Retirer le compte',
      tone: 'danger'
    })
    if (!ok) return
    await api.accounts.remove(account.id)
    toast('Compte retiré')
    openSettings('general')
  }

  return (
    <>
      <div className="mb-7 flex items-center gap-3">
        <span className="size-3 rounded-[4px]" style={{ background: account.color }} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{account.email}</h2>
          <p className="text-[12px] text-muted">
            {account.kind === 'google' ? 'Google' : `IMAP · ${account.imapHost}`}
            {account.lastSyncAt &&
              ` · synchronisé à ${new Date(account.lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <button
          onClick={() =>
            void api.mail
              .sync(account.id)
              .then(() => toast('Compte synchronisé'))
              .catch((e: Error) => toast(e.message, 'error'))
          }
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
        >
          <RefreshCw size={13} /> Synchroniser
        </button>
      </div>
      {account.syncError && (
        <p className="mb-5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{account.syncError}</p>
      )}

      <Section title="Identité">
        <Row label="Nom affiché aux destinataires" stack>
          <input value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} aria-label="Nom affiché" />
        </Row>
        <Row
          label="Signature"
          hint="Ajoutée aux nouveaux messages, réponses et transferts. Texte simple, ou code HTML collé depuis un générateur de signature."
          stack
        >
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={isHtmlSignature(signature) ? 8 : 4}
            spellCheck={!isHtmlSignature(signature)}
            className={`${fieldCls} h-auto resize-y py-2 ${isHtmlSignature(signature) ? 'font-mono text-[12px]' : ''}`}
            aria-label="Signature"
          />
          {signature.trim() && (
            <div className="mt-3">
              <p className="mb-1.5 text-[12px] text-muted">
                Aperçu, tel que vos destinataires le verront{isHtmlSignature(signature) ? ' · HTML' : ''}
              </p>
              <HtmlPreview label="Aperçu de la signature" html={(isHtmlSignature(signature) ? '' : '-- <br>') + signatureHtml(signature)} />
            </div>
          )}
        </Row>
        {dirty && (
          <div className="flex justify-end px-4 py-3">
            <button onClick={() => void save()} className="btn-primary h-8 rounded-lg px-3.5 text-[12.5px] font-medium">
              Enregistrer
            </button>
          </div>
        )}
      </Section>

      <TemplatesSection account={account} />

      <Section title="Repère dans la boîte unifiée" description="Pour reconnaître d’un coup d’œil les messages de ce compte.">
        <Row label="Nom court" hint="Affiché sur l’étiquette et dans la barre latérale. Vide : déduit du nom du compte.">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 12))}
            onBlur={() => label !== account.label && patch({ label: label.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder={accountLabel({ ...account, label: '' })}
            aria-label="Nom court du compte"
            className={`${fieldCls} w-40`}
          />
        </Row>
        <Row label="Couleur" stack>
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => patch({ color: c })}
                aria-label={`Couleur ${c}`}
                className={`size-6 rounded-full transition-transform hover:scale-110 ${account.color.toLowerCase() === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-[var(--surface-solid)]' : ''}`}
                style={{ background: c }}
              />
            ))}
            <span className="ml-1">
              <ColorPicker label="Couleur personnalisée du compte" value={account.color} onChange={(v) => patch({ color: v })} />
            </span>
          </div>
        </Row>
        <Row
          label="Aperçu"
          hint={
            <button onClick={() => openSettings('appearance')} className="text-accent hover:underline">
              Changer le style de repère
            </button>
          }
          stack
        >
          <div className="max-w-[420px]">
            <MarkerSample marker={marker === 'none' ? 'stripe' : marker} account={{ ...account, label }} />
          </div>
        </Row>
      </Section>

      <Section title="Boîte de réception">
        <Row label="Inclure dans la boîte unifiée" hint="Sinon, ce compte n’apparaît que dans ses propres dossiers.">
          <Toggle label="" checked={account.inUnified} onChange={(v) => patch({ inUnified: v })} />
        </Row>
        <Row label="Notifications" hint="Les réglages généraux (heures calmes, tri intelligent) s’appliquent en plus.">
          <Toggle label="" checked={account.notify} onChange={(v) => patch({ notify: v })} />
        </Row>
        <Row
          label="Messages gardés sur cet ordinateur"
          hint="Les plus récents de chaque dossier ; la recherche porte sur eux. Les plus anciens restent sur le serveur."
        >
          <Select
            ariaLabel="Profondeur de synchronisation"
            className="w-44"
            value={String(account.syncDepth)}
            onChange={(v) => patch({ syncDepth: Number(v) })}
            options={[200, 400, 1000, 2500, 5000].map((n) => ({ value: String(n), label: `${n.toLocaleString('fr-FR')} par dossier` }))}
          />
        </Row>
      </Section>

      {account.kind === 'imap' && (
        <Section
          title="Agenda"
          description="Les agendas CalDAV de ce compte (mêmes identifiants que la messagerie). Pour un autre serveur, ajoutez un agenda indépendant."
        >
          <Row label="Adresse CalDAV" stack>
            <input
              value={caldavUrl}
              onChange={(e) => setCaldavUrl(e.target.value)}
              className={fieldCls}
              placeholder="https://"
              aria-label="Adresse CalDAV"
            />
          </Row>
        </Section>
      )}

      <Section title="Zone sensible">
        <Row label="Retirer ce compte" hint="Efface la copie locale ; rien n’est supprimé sur le serveur.">
          <button onClick={() => void remove()} className="h-8 rounded-lg border border-danger/40 px-3 text-[12.5px] text-danger hover:bg-danger/10">
            Retirer le compte
          </button>
        </Row>
      </Section>
    </>
  )
}

/** Templates of this account: reusable messages with {{fields}} filled in when used. */
function TemplatesSection({ account }: { account: Account }) {
  const { toast } = useStore.getState()
  const [templates, setTemplates] = useState<MailTemplate[]>([])
  const [editing, setEditing] = useState<MailTemplateInput | null>(null)
  const load = useCallback(() => void api.templates.list(account.id).then(setTemplates), [account.id])
  useEffect(load, [load])

  const remove = async (t: MailTemplate): Promise<void> => {
    const ok = await confirmDialog({
      title: `Supprimer « ${t.name} » ?`,
      body: 'Ce modèle ne sera plus proposé.',
      confirmLabel: 'Supprimer',
      tone: 'danger'
    })
    if (!ok) return
    await api.templates.remove(t.id)
    toast('Modèle supprimé')
    load()
  }

  return (
    <Section
      title="Modèles"
      description="Des messages prêts à l’emploi pour ce compte. Les champs entre accolades, comme {{Prénom}}, sont demandés au moment de l’insérer depuis le bouton Modèles du composeur."
    >
      {templates.map((t) => {
        const fields = templateFields(t.subject, t.html)
        return (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <FileText size={15} className="shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{t.name}</p>
              <p className="truncate text-[12px] text-muted">
                {[t.subject || 'Sans objet', fields.length ? `${fields.length} champ${fields.length > 1 ? 's' : ''} : ${fields.join(', ')}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <button
              onClick={() => setEditing(t)}
              aria-label={`Modifier ${t.name}`}
              title="Modifier"
              className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => void remove(t)}
              aria-label={`Supprimer ${t.name}`}
              title="Supprimer"
              className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )
      })}
      <div className="px-4 py-3">
        <button
          onClick={() => setEditing({ accountId: account.id, name: '', subject: '', html: '', to: [], cc: [] })}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
        >
          <Plus size={13} /> Nouveau modèle
        </button>
      </div>
      {editing && <TemplateEditor initial={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </Section>
  )
}
