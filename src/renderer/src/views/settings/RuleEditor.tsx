import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { MAIL_CATEGORIES, type MailRule, type RuleCondition, type RuleField, type RuleOp } from '@shared/types'
import { api, useStore } from '../../store'
import { Checkbox, Select } from '../../components/ui/Controls'
import { fieldCls } from '../../components/Modal'
import { CATEGORY_LABEL } from '../../lib/categories'
import { ROLE_LABEL } from '../../lib/format'

const FIELD_LABEL: Record<RuleField, string> = {
  from: 'L’expéditeur',
  domain: 'Le domaine de l’expéditeur',
  to: 'Un destinataire',
  subject: 'L’objet'
}
const OP_LABEL: Record<RuleOp, string> = { contains: 'contient', is: 'est' }

/** One-line summary of a rule for the list. */
export function describeRule(r: MailRule): string {
  const when = r.conditions.map((c) => `${FIELD_LABEL[c.field].toLowerCase()} ${OP_LABEL[c.op]} « ${c.value} »`).join(' et ')
  const then = [
    r.actions.category && `classer dans ${CATEGORY_LABEL[r.actions.category]}`,
    r.actions.markRead && 'marquer comme lu',
    r.actions.star && 'suivre',
    r.actions.moveTo && 'déplacer',
    r.actions.mute && 'sans notification'
  ].filter(Boolean)
  return `Si ${when || '…'} → ${then.join(', ') || 'aucune action'}`
}

export function RuleEditor({ rule, onCancel, onSaved }: { rule: MailRule; onCancel: () => void; onSaved: () => void }) {
  const accounts = useStore((s) => s.accounts)
  const folders = useStore((s) => s.folders)
  const { toast } = useStore.getState()
  const [r, setR] = useState<MailRule>(rule)
  const [busy, setBusy] = useState(false)

  const setCond = (i: number, patch: Partial<RuleCondition>): void =>
    setR({ ...r, conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const setAct = (patch: Partial<MailRule['actions']>): void => setR({ ...r, actions: { ...r.actions, ...patch } })
  const accountFolders = folders.filter((f) => f.accountId === r.accountId && f.role !== 'all' && f.role !== 'flagged')
  const valid = r.conditions.some((c) => c.value.trim())

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const name = r.name.trim() || describeRule(r).slice(3, 60)
      await api.rules.save({ ...r, name })
      const n = await api.rules.reapply()
      toast(n ? `Règle enregistrée · ${n} message${n > 1 ? 's' : ''} reclassé${n > 1 ? 's' : ''}` : 'Règle enregistrée')
      onSaved()
    } catch (err) {
      toast((err as Error).message, 'error')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 bg-white/[0.02] px-4 py-4">
      <input
        value={r.name}
        onChange={(e) => setR({ ...r, name: e.target.value })}
        placeholder="Nom de la règle (facultatif)"
        className={fieldCls}
        aria-label="Nom de la règle"
      />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          Pour
          <Select
            ariaLabel="Compte"
            className="w-56"
            value={r.accountId ?? '*'}
            onChange={(v) => setR({ ...r, accountId: v === '*' ? null : v, actions: { ...r.actions, moveTo: undefined } })}
            options={[{ value: '*', label: 'Tous les comptes' }, ...accounts.map((a) => ({ value: a.id, label: a.email, swatch: a.color }))]}
          />
          , si toutes ces conditions sont vraies :
        </div>
        {r.conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select
              ariaLabel="Champ"
              className="w-56"
              value={c.field}
              onChange={(v) => setCond(i, { field: v })}
              options={(Object.keys(FIELD_LABEL) as RuleField[]).map((f) => ({ value: f, label: FIELD_LABEL[f] }))}
            />
            <Select
              ariaLabel="Opérateur"
              className="w-28"
              value={c.op}
              onChange={(v) => setCond(i, { op: v })}
              options={(Object.keys(OP_LABEL) as RuleOp[]).map((o) => ({ value: o, label: OP_LABEL[o] }))}
            />
            <input
              value={c.value}
              onChange={(e) => setCond(i, { value: e.target.value })}
              placeholder={c.field === 'domain' ? 'exemple.com' : c.field === 'subject' ? 'facture' : 'nom ou adresse'}
              aria-label="Valeur"
              className={`${fieldCls} min-w-40 flex-1`}
            />
            {r.conditions.length > 1 && (
              <button
                onClick={() => setR({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })}
                aria-label="Retirer la condition"
                className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => setR({ ...r, conditions: [...r.conditions, { field: 'subject', op: 'contains', value: '' }] })}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted hover:bg-hover hover:text-fg"
        >
          <Plus size={13} /> Ajouter une condition
        </button>
      </div>

      <div className="space-y-2.5">
        <p className="text-[12.5px] text-muted">Alors :</p>
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={!!r.actions.category}
            onChange={(on) => setAct({ category: on ? 'newsletters' : undefined })}
            label="Classer dans une catégorie"
          />
          <span className="text-[13px]">Classer dans</span>
          <Select
            ariaLabel="Catégorie"
            className="w-44"
            disabled={!r.actions.category}
            value={r.actions.category ?? 'newsletters'}
            onChange={(v) => setAct({ category: v })}
            options={MAIL_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          />
        </div>
        {(
          [
            ['markRead', 'Marquer comme lu'],
            ['star', 'Suivre'],
            ['mute', 'Ne pas notifier']
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox checked={!!r.actions[key]} onChange={(on) => setAct({ [key]: on || undefined })} label={label} />
            {label}
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={!!r.actions.moveTo}
            onChange={(on) => setAct({ moveTo: on ? (accountFolders.find((f) => f.role === 'archive')?.id ?? accountFolders[0]?.id) : undefined })}
            label="Déplacer"
          />
          <span className="text-[13px]">Déplacer vers</span>
          {r.accountId ? (
            <Select
              ariaLabel="Dossier"
              className="w-56"
              disabled={!r.actions.moveTo}
              value={r.actions.moveTo ?? accountFolders[0]?.id ?? ''}
              onChange={(v) => setAct({ moveTo: v })}
              options={accountFolders.map((f) => ({ value: f.id, label: f.role ? ROLE_LABEL[f.role] : f.path }))}
            />
          ) : (
            <span className="text-[12px] text-muted">choisissez d’abord un compte précis</span>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="h-8 rounded-lg border border-line px-3 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg">
          Annuler
        </button>
        <button
          onClick={() => void save()}
          disabled={busy || !valid}
          className="btn-primary h-8 rounded-lg px-3.5 text-[12.5px] font-medium disabled:opacity-50"
        >
          {busy ? 'Enregistrement…' : 'Enregistrer la règle'}
        </button>
      </div>
    </div>
  )
}
