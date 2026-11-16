import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import type { MailCategory, MailRule } from '@shared/types'
import { api, confirmDialog, useStore } from '../../store'
import { Toggle } from '../../components/ui/Controls'
import { CATEGORY_LABEL, CATEGORY_HINT } from '../../lib/categories'
import { Row, Section } from './parts'
import { RuleEditor, describeRule } from './RuleEditor'

export function InboxSettings() {
  const settings = useStore((s) => s.settings)!
  const update = useStore((s) => s.updateSettings)
  const { toast } = useStore.getState()
  const [rules, setRules] = useState<MailRule[]>([])
  const [editing, setEditing] = useState<MailRule | null>(null)

  const load = useCallback(() => void api.rules.list().then(setRules), [])
  useEffect(load, [load])

  const toggleCategory = (c: MailCategory, on: boolean): void => {
    const next = on ? [...new Set([...settings.categories, c])] : settings.categories.filter((x) => x !== c)
    void update({ categories: next })
  }

  const move = async (i: number, dir: -1 | 1): Promise<void> => {
    const next = [...rules]
    ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
    setRules(next)
    await api.rules.reorder(next.map((r) => r.id))
  }

  return (
    <>
      <Section
        title="Tri intelligent"
        description="Comme dans Spark : les messages de personnes d’un côté, le reste rangé automatiquement. Le tri se fait sur votre ordinateur, à partir des en-têtes des messages et des gens à qui vous écrivez."
      >
        <Row label="Activer le tri intelligent" hint="Ajoute des onglets en haut de la boîte de réception.">
          <Toggle label="" checked={settings.smartInbox} onChange={(v) => void update({ smartInbox: v })} />
        </Row>
        {settings.smartInbox &&
          (['notifications', 'newsletters', 'invitations'] as const).map((c) => (
            <Row key={c} label={`Onglet ${CATEGORY_LABEL[c]}`} hint={CATEGORY_HINT[c]}>
              <Toggle label="" checked={settings.categories.includes(c)} onChange={(v) => toggleCategory(c, v)} />
            </Row>
          ))}
      </Section>

      <Section
        title="Règles"
        description="Appliquées dans l’ordre à chaque nouveau message. La catégorie de la première règle qui correspond l’emporte ; les autres actions s’additionnent."
      >
        {rules.length === 0 && !editing && (
          <div className="px-4 py-6 text-center">
            <p className="text-[13px] text-fg-2">Aucune règle pour l’instant</p>
            <p className="mt-1 text-[12px] text-muted">Astuce : clic droit sur une conversation › « Toujours classer les messages de… ».</p>
          </div>
        )}
        {rules.map((r, i) =>
          editing?.id === r.id ? (
            <RuleEditor
              key={r.id}
              rule={editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null)
                load()
              }}
            />
          ) : (
            <div key={r.id} className={`group flex items-center gap-3 px-4 py-3 ${r.enabled ? '' : 'opacity-50'}`}>
              <Toggle label="" checked={r.enabled} onChange={(v) => void api.rules.save({ ...r, enabled: v }).then(load)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{r.name}</p>
                <p className="truncate text-[12px] text-muted">{describeRule(r)}</p>
              </div>
              <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button
                  disabled={i === 0}
                  onClick={() => void move(i, -1)}
                  aria-label="Monter"
                  className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  disabled={i === rules.length - 1}
                  onClick={() => void move(i, 1)}
                  aria-label="Descendre"
                  className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  onClick={() => setEditing(r)}
                  aria-label="Modifier la règle"
                  className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={async () => {
                    if (await confirmDialog({ title: `Supprimer « ${r.name} » ?`, confirmLabel: 'Supprimer', tone: 'danger' })) {
                      await api.rules.remove(r.id)
                      load()
                    }
                  }}
                  aria-label="Supprimer la règle"
                  className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-danger"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        )}
        {editing && !editing.id && (
          <RuleEditor
            rule={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              load()
            }}
          />
        )}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <button
            onClick={() =>
              setEditing({
                id: '',
                name: '',
                enabled: true,
                accountId: null,
                conditions: [{ field: 'from', op: 'contains', value: '' }],
                actions: { category: 'newsletters' }
              })
            }
            disabled={!!editing}
            className="btn-primary flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-50"
          >
            <Plus size={14} /> Nouvelle règle
          </button>
          <button
            onClick={async () => {
              const n = await api.rules.reapply()
              toast(n ? `${n} message${n > 1 ? 's' : ''} reclassé${n > 1 ? 's' : ''}` : 'Tout était déjà bien classé')
            }}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
          >
            <Wand2 size={14} /> Réappliquer aux messages existants
          </button>
        </div>
      </Section>
    </>
  )
}
