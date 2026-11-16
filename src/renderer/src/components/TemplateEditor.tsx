import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { MailTemplate, MailTemplateInput } from '@shared/types'
import { api, useStore } from '../store'
import { Modal, Label, fieldCls } from './Modal'
import { RecipientInput } from './RecipientInput'
import { SelectionToolbar } from './SelectionToolbar'
import { templateFields } from '../lib/templates'

/** Creates or edits a template: name, subject, default recipients and a rich-text body with {{fields}}. */
export function TemplateEditor({
  initial,
  onClose,
  onSaved
}: {
  initial: MailTemplateInput
  onClose: () => void
  onSaved?: (t: MailTemplate) => void
}) {
  const [name, setName] = useState(initial.name)
  const [subject, setSubject] = useState(initial.subject)
  const [to, setTo] = useState(initial.to)
  const [html, setHtml] = useState(initial.html)
  const [saving, setSaving] = useState(false)
  const editor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editor.current) editor.current.innerHTML = DOMPurify.sanitize(initial.html, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'script'] })
    // Mount only: the editor owns its content afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fields = templateFields(subject, html)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await api.templates.save({ ...initial, name, subject, to, html: editor.current?.innerHTML ?? html })
      useStore.getState().toast(initial.id ? 'Modèle enregistré' : `Modèle « ${saved.name} » créé`)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      useStore.getState().toast((err as Error).message, 'error')
      setSaving(false)
    }
  }

  return (
    <Modal title={initial.id ? 'Modifier le modèle' : 'Nouveau modèle'} onClose={onClose} width={640}>
      <div className="space-y-4 px-5 pb-5">
        <Label text="Nom du modèle">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldCls}
            placeholder="Relance devis"
            aria-label="Nom du modèle"
          />
        </Label>
        <Label text="Objet">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={fieldCls}
            placeholder="Votre devis {{Numéro}}"
            aria-label="Objet du modèle"
          />
        </Label>
        <div>
          <span className="mb-1.5 block text-[12.5px] text-fg-2">Destinataires par défaut (facultatif)</span>
          <div className="flex min-h-9 items-center rounded-md border border-line bg-panel px-2">
            <RecipientInput ariaLabel="Destinataires du modèle" value={to} onChange={setTo} />
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-[12.5px] text-fg-2">Message</span>
          <div className="max-h-[42vh] min-h-40 overflow-y-auto rounded-md border border-line bg-panel px-3 py-2.5 focus-within:border-accent">
            <div
              ref={editor}
              contentEditable
              className="prose-compose min-h-32"
              data-placeholder="Bonjour {{Prénom}},"
              spellCheck
              aria-label="Corps du modèle"
              onInput={(e) => setHtml(e.currentTarget.innerHTML)}
            />
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
            Écrivez <code className="rounded bg-hover px-1">{'{{Prénom}}'}</code> pour un champ à remplir à chaque envoi. Sélectionnez du texte pour
            le mettre en forme. La signature du compte s’ajoute toute seule.
          </p>
          {fields.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-2">
              Champs :
              {fields.map((f) => (
                <span key={f} className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11.5px] font-medium text-accent">
                  {f}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="h-9 rounded-lg px-4 text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
            Annuler
          </button>
          <button
            disabled={saving || !name.trim()}
            onClick={() => void save()}
            className="btn-primary h-9 rounded-lg px-4 text-[13px] font-medium disabled:opacity-50"
          >
            Enregistrer
          </button>
        </div>
      </div>
      <SelectionToolbar editor={editor} />
    </Modal>
  )
}

/** Asks for the {{fields}} of a template before it goes into a message. */
export function TemplateFill({
  template,
  fields,
  onApply,
  onClose
}: {
  template: MailTemplate
  fields: string[]
  onApply: (values: Record<string, string>) => void
  onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const apply = (): void => {
    onApply(values)
    onClose()
  }
  return (
    <Modal title={`Remplir « ${template.name} »`} onClose={onClose} width={440}>
      <form
        className="space-y-3 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        {fields.map((f, i) => (
          <Label key={f} text={f}>
            <input
              autoFocus={i === 0}
              value={values[f] ?? ''}
              onChange={(e) => setValues({ ...values, [f]: e.target.value })}
              className={fieldCls}
              aria-label={f}
            />
          </Label>
        ))}
        <p className="text-[11.5px] text-muted">Un champ laissé vide reste affiché tel quel dans le message, pour le compléter avant l’envoi.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-4 text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
            Annuler
          </button>
          <button type="submit" className="btn-primary h-9 rounded-lg px-4 text-[13px] font-medium">
            Insérer
          </button>
        </div>
      </form>
    </Modal>
  )
}
