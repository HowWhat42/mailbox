import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { ArrowLeft, FileText, ImagePlus, Paperclip, Send, Trash2, Upload, X } from 'lucide-react'
import type { MailTemplate, OutgoingAttachment, OutgoingMessage } from '@shared/types'
import { api, confirmDialog, useStore, type ComposeDraft } from '../store'
import { formatAddresses, htmlToText } from '../lib/format'
import { SIGNATURE_ATTR, signatureBlock } from '../lib/signature'
import { fillTemplate, templateFields } from '../lib/templates'
import { caretAt, imageFiles, insertImages, pickImages } from '../lib/inlineImages'
import { Menu, type MenuEntry } from './ui/Menu'
import { Modal, Label, fieldCls } from './Modal'
import { TemplateFill } from './TemplateEditor'
import { AttachmentCard } from './AttachmentCard'
import { SelectionToolbar } from './SelectionToolbar'
import { RecipientInput, isValidAddress } from './RecipientInput'
import { Select } from './ui/Controls'
import { useLayout } from '../lib/layout'
import { accountLabel } from '../lib/accounts'

const AUTOSAVE_MS = 5000

/** What a save would store: an unchanged fingerprint means the server copy is already current. */
function fingerprint(m: OutgoingMessage): string {
  return JSON.stringify([m.accountId, m.to, m.cc, m.bcc, m.subject, m.html, m.attachments.map((a) => [a.name, a.size])])
}
const TITLES: Record<ComposeDraft['kind'], string> = {
  new: 'Nouveau message',
  reply: 'Répondre',
  replyAll: 'Répondre à tous',
  forward: 'Transférer',
  draft: 'Brouillon'
}

function Row({ label, children, trailing }: { label: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-line px-4 @[600px]:px-6">
      <span className="w-12 shrink-0 text-[13px] text-muted">{label}</span>
      {children}
      {trailing}
    </div>
  )
}

/** Top-level nodes the user writes: everything before the signature or the quoted history. */
function ownNodes(editor: HTMLElement): ChildNode[] {
  const out: ChildNode[] = []
  for (const n of editor.childNodes) {
    if (n instanceof HTMLElement && (n.hasAttribute(SIGNATURE_ATTR) || n.hasAttribute('data-mailbox-quote'))) break
    out.push(n)
  }
  return out
}

function ownHtml(editor: HTMLElement): string {
  return ownNodes(editor)
    .map((n) => (n instanceof Element ? n.outerHTML : (n.textContent ?? '')))
    .join('')
}

/** Name of a new template, asked from the composer. */
function SaveTemplateDialog({ onSave, onClose }: { onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  return (
    <Modal title="Enregistrer comme modèle" onClose={onClose} width={420}>
      <form
        className="space-y-3 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          onSave(name.trim())
          onClose()
        }}
      >
        <Label text="Nom du modèle" hint="L’objet, les destinataires et le texte (sans la signature ni la citation) sont repris.">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldCls}
            placeholder="Relance devis"
            aria-label="Nom du modèle"
          />
        </Label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-4 text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
            Annuler
          </button>
          <button type="submit" disabled={!name.trim()} className="btn-primary h-9 rounded-lg px-4 text-[13px] font-medium disabled:opacity-50">
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  )
}

function isEmpty(d: ComposeDraft, html: string): boolean {
  return (
    !d.to.length &&
    !d.cc.length &&
    !d.bcc.length &&
    !d.subject.trim() &&
    !d.attachments.length &&
    !htmlToText(html)
      .replace(/^--\s*$[\s\S]*/m, '')
      .trim()
  )
}

export function Composer() {
  const draft = useStore((s) => s.composer)!
  const accounts = useStore((s) => s.accounts)
  const { updateComposer, closeComposer, toast, compose } = useStore.getState()
  const [showCc, setShowCc] = useState(!!(draft.cc.length || draft.bcc.length))
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(draft.draftId ? Date.now() : null)
  const [saving, setSaving] = useState(false)
  const editor = useRef<HTMLDivElement>(null)
  const { single } = useLayout()
  const [templateMenu, setTemplateMenu] = useState<{ anchor: HTMLElement; items: MenuEntry[] } | null>(null)
  const [filling, setFilling] = useState<{ template: MailTemplate; fields: string[] } | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)

  // Latest state for timers and unmount, without re-subscribing effects.
  const latest = useRef(draft)
  latest.current = draft
  const dirty = useRef(false)
  const done = useRef(false)
  const inflight = useRef<Promise<void> | null>(null)
  const savedPrint = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const message = useCallback((d: ComposeDraft): OutgoingMessage => {
    const html = editor.current?.innerHTML ?? d.html
    return {
      accountId: d.accountId,
      to: formatAddresses(d.to),
      cc: formatAddresses(d.cc),
      bcc: formatAddresses(d.bcc),
      subject: d.subject,
      html,
      text: htmlToText(html),
      inReplyTo: d.inReplyTo,
      references: d.references,
      attachments: d.attachments,
      draftId: d.draftId
    }
  }, [])

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    if (inflight.current) await inflight.current
    const d = latest.current
    const html = editor.current?.innerHTML ?? d.html
    if (!dirty.current || isEmpty(d, html)) return
    dirty.current = false
    const msg = message(d)
    const print = fingerprint(msg)
    if (print === savedPrint.current) return
    setSaving(true)
    const job = api.mail
      .saveDraft(msg)
      .then((res) => {
        if (!res) return
        savedPrint.current = print
        // Keep the composer's view of attachments in step with what the server now holds.
        if (useStore.getState().composer?.key === d.key) updateComposer({ draftId: res.id, attachments: res.attachments })
        latest.current = { ...latest.current, draftId: res.id, attachments: res.attachments }
        setSavedAt(Date.now())
      })
      .catch(() => {
        dirty.current = true
      })
      .finally(() => {
        setSaving(false)
        inflight.current = null
      })
    inflight.current = job
    await job
  }, [message, updateComposer])

  const touch = useCallback((): void => {
    dirty.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS)
  }, [save])

  const set = <K extends keyof ComposeDraft>(key: K, value: ComposeDraft[K]): void => {
    updateComposer({ [key]: value } as Partial<ComposeDraft>)
    touch()
  }

  useEffect(() => {
    const account = accounts.find((a) => a.id === draft.accountId)
    const signature = account?.signature && draft.kind !== 'draft' ? `<p><br></p>${signatureBlock(account.signature)}` : ''
    // Quoted mail comes from strangers: sanitize before it lands in a live contentEditable.
    const body = DOMPurify.sanitize(draft.html, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'script'] })
    if (editor.current)
      editor.current.innerHTML = draft.html ? (signature ? body.replace('<p><br></p>', `<p><br></p>${signature}`) : body) : signature
    // A restored draft that never reached the server must still be saved when closed.
    if (draft.kind === 'draft' && !draft.draftId) dirty.current = true
    if (draft.to.length) {
      editor.current?.focus()
      window.getSelection()?.setPosition(editor.current, 0)
    }
    return () => {
      clearTimeout(timer.current)
      // Leaving the composer (Escape, opening another thread…) keeps the work as a draft.
      if (!done.current && dirty.current) {
        void save().then(() => toast('Brouillon enregistré'))
      }
    }
    // Mount/unmount only: the draft is the initial state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Puts a filled-in template above the signature and quoted history, and its subject and recipients in place. */
  const applyTemplate = async (t: MailTemplate, values: Record<string, string>): Promise<void> => {
    const el = editor.current
    if (!el) return
    const filled = fillTemplate(t.subject, t.html, values)
    const written = ownNodes(el)
    const hasText = written.some((n) => (n.textContent ?? '').trim() || (n instanceof Element && n.querySelector('img')))
    if (
      hasText &&
      !(await confirmDialog({
        title: 'Remplacer votre texte ?',
        body: `Le modèle « ${t.name} » remplace ce que vous avez écrit. La signature et le message cité sont gardés.`,
        confirmLabel: 'Remplacer'
      }))
    )
      return
    for (const n of written) n.remove()
    const fragment = document
      .createRange()
      .createContextualFragment(`${DOMPurify.sanitize(filled.html, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'script'] })}<p><br></p>`)
    el.insertBefore(fragment, el.firstChild)
    const d = latest.current
    const known = new Set([...d.to, ...d.cc].map((a) => a.address.toLowerCase()))
    const patch: Partial<ComposeDraft> = {}
    if (filled.subject && !d.subject.trim()) patch.subject = filled.subject
    const to = t.to.filter((a) => !known.has(a.address.toLowerCase()))
    const cc = t.cc.filter((a) => !known.has(a.address.toLowerCase()))
    if (to.length) patch.to = [...d.to, ...to]
    if (cc.length) {
      patch.cc = [...d.cc, ...cc]
      setShowCc(true)
    }
    if (Object.keys(patch).length) updateComposer(patch)
    touch()
    el.focus()
  }

  const pickTemplate = (t: MailTemplate): void => {
    const fields = templateFields(t.subject, t.html)
    if (fields.length) setFilling({ template: t, fields })
    else void applyTemplate(t, {})
  }

  const openTemplates = async (anchor: HTMLElement): Promise<void> => {
    const d = latest.current
    const list = await api.templates.list(d.accountId)
    const account = accounts.find((a) => a.id === d.accountId)
    setTemplateMenu({
      anchor,
      items: [
        ...list.map((t): MenuEntry => ({ label: t.name, hint: t.subject || undefined, icon: FileText, onSelect: () => pickTemplate(t) })),
        ...(list.length ? (['separator'] as MenuEntry[]) : []),
        { label: 'Enregistrer ce message comme modèle…', onSelect: () => setSavingTemplate(true) },
        {
          label: list.length ? 'Gérer les modèles…' : 'Créer un modèle…',
          onSelect: () => useStore.getState().openSettings(`account:${d.accountId}`),
          hint: list.length ? undefined : account ? `pour ${account.email}` : undefined
        }
      ]
    })
  }

  const saveAsTemplate = async (name: string): Promise<void> => {
    const d = latest.current
    try {
      await api.templates.save({
        accountId: d.accountId,
        name,
        subject: d.subject,
        html: editor.current ? ownHtml(editor.current) : '',
        to: d.to,
        cc: d.cc
      })
      toast(`Modèle « ${name} » enregistré`)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** Sending account changed: its own signature replaces the previous one. */
  const switchAccount = (accountId: string): void => {
    const el = editor.current
    const sig = accounts.find((a) => a.id === accountId)?.signature ?? ''
    const current = el?.querySelector(`[${SIGNATURE_ATTR}]`)
    if (el && current) {
      if (sig) current.outerHTML = signatureBlock(sig)
      else current.remove()
    } else if (el && sig && draft.kind === 'new') {
      el.insertAdjacentHTML('beforeend', `<p><br></p>${signatureBlock(sig)}`)
    }
    set('accountId', accountId)
  }

  const addFiles = (files: OutgoingAttachment[]): void => {
    if (files.length) set('attachments', [...latest.current.attachments, ...files])
  }

  const send = async (): Promise<void> => {
    if (sending) return
    const d = latest.current
    if (!d.to.length && !d.cc.length && !d.bcc.length) {
      toast('Ajoutez au moins un destinataire.', 'error')
      return
    }
    const invalid = [...d.to, ...d.cc, ...d.bcc].filter((a) => !isValidAddress(a))
    if (invalid.length) {
      toast(`Adresse invalide : ${invalid.map((a) => a.address).join(', ')}`, 'error')
      return
    }
    if (
      !d.subject.trim() &&
      !(await confirmDialog({
        title: 'Envoyer sans objet ?',
        body: 'Ce message n’a pas d’objet.',
        confirmLabel: 'Envoyer quand même',
        cancelLabel: 'Ajouter un objet'
      }))
    )
      return
    setSending(true)
    clearTimeout(timer.current)
    // No waiting for an autosave in flight: the draft it writes is dropped once the message is sent.
    try {
      const msg = message(latest.current)
      const result = await api.mail.send(msg)
      done.current = true
      const dropLateDraft = (): void => {
        const id = latest.current.draftId
        if (id && id !== msg.draftId) void api.mail.deleteDraft(id).catch(() => {})
      }
      if (inflight.current) void inflight.current.then(dropLateDraft)
      else dropLateDraft()
      closeComposer()
      toast(result === 'queued' ? 'Hors ligne : le message partira dès le retour de la connexion' : 'Message envoyé')
    } catch (err) {
      toast((err as Error).message, 'error')
      setSending(false)
    }
  }

  const discard = async (): Promise<void> => {
    clearTimeout(timer.current)
    if (inflight.current) await inflight.current
    // Restored as a 'draft' so the signature isn't added a second time.
    const snapshot: ComposeDraft = {
      ...latest.current,
      kind: 'draft',
      html: editor.current?.innerHTML ?? latest.current.html,
      key: crypto.randomUUID()
    }
    done.current = true
    closeComposer()
    if (isEmpty(snapshot, snapshot.html) && !snapshot.draftId) return
    let undone = false
    toast('Brouillon supprimé', 'info', {
      label: 'Annuler',
      run: () => {
        undone = true
        compose(snapshot)
      }
    })
    setTimeout(() => {
      if (!undone && snapshot.draftId) void api.mail.deleteDraft(snapshot.draftId).catch(() => {})
    }, 5000)
  }

  const close = (): void => closeComposer()

  return (
    // Keyboard shortcuts and file drops are handled for the whole composer.
    <section
      role="presentation"
      className="@container relative flex min-w-0 flex-1 flex-col"
      onKeyDown={(e) => {
        // Template dialogs live inside the composer: their Escape / Enter are theirs.
        if ((e.target as HTMLElement).closest('[data-modal]')) return
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void send()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          close()
        }
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        // Pictures dropped on the text go in the message; anything else, or dropped elsewhere, is attached.
        const files = [...e.dataTransfer.files]
        const images = imageFiles(files)
        if (editor.current && editor.current.contains(e.target as Node) && images.length === files.length) {
          caretAt(e.clientX, e.clientY)
          void insertImages(editor.current, images)
          return
        }
        const paths = files.map((f) => api.app.pathForFile(f)).filter(Boolean)
        void api.mail.fileInfo(paths).then(addFiles)
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 @[600px]:px-6">
        {single && (
          <button
            onClick={close}
            aria-label="Retour"
            title="Retour (garde le brouillon)"
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{TITLES[draft.kind]}</h2>
        <span className="ml-1 hidden truncate text-[12px] text-muted @[480px]:inline">
          {saving
            ? 'Enregistrement…'
            : savedAt
              ? `Brouillon enregistré à ${new Date(savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
              : ''}
        </span>
        <button
          onClick={close}
          title="Fermer et garder le brouillon (Échap)"
          aria-label="Fermer"
          className="ml-auto grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {accounts.length > 1 && (
          <Row label="De">
            <Select
              ariaLabel="Compte d’envoi"
              value={draft.accountId}
              onChange={switchAccount}
              options={accounts.map((a) => ({ value: a.id, label: `${accountLabel(a)} · ${a.name} <${a.email}>`, swatch: a.color }))}
              className="max-w-[420px] flex-1"
            />
          </Row>
        )}
        <Row
          label="À"
          trailing={
            !showCc && (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className="shrink-0 rounded-md px-2 py-1 text-[12.5px] text-muted hover:bg-hover hover:text-fg"
              >
                Cc Cci
              </button>
            )
          }
        >
          <RecipientInput ariaLabel="Destinataires" value={draft.to} onChange={(v) => set('to', v)} autoFocus={!draft.to.length} />
        </Row>
        {showCc && (
          <>
            <Row label="Cc">
              <RecipientInput ariaLabel="Copie" value={draft.cc} onChange={(v) => set('cc', v)} />
            </Row>
            <Row label="Cci">
              <RecipientInput ariaLabel="Copie cachée" value={draft.bcc} onChange={(v) => set('bcc', v)} />
            </Row>
          </>
        )}
        <Row label="Objet">
          <input
            value={draft.subject}
            onChange={(e) => set('subject', e.target.value)}
            aria-label="Objet"
            className="h-11 min-w-0 flex-1 bg-transparent text-[14px] font-medium text-fg placeholder:text-faint focus:outline-none"
            placeholder="De quoi s’agit-il ?"
          />
        </Row>

        <div className="px-4 py-5 @[600px]:px-6">
          <div
            ref={editor}
            contentEditable
            className="prose-compose"
            data-placeholder="Écrivez votre message…"
            spellCheck
            onInput={touch}
            onPaste={(e) => {
              const images = imageFiles(e.clipboardData.files)
              if (!images.length) return
              e.preventDefault()
              void insertImages(e.currentTarget, images)
            }}
          />
        </div>

        {draft.attachments.length > 0 && (
          <div className="flex flex-wrap gap-3 px-4 pb-6 @[600px]:px-6">
            {draft.attachments.map((a, i) => (
              <AttachmentCard
                key={`${a.kind === 'file' ? a.path : a.messageId + a.attachmentId}-${i}`}
                name={a.name}
                size={a.size}
                onRemove={() =>
                  set(
                    'attachments',
                    draft.attachments.filter((_, j) => j !== i)
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      <footer className="flex h-14 shrink-0 items-center gap-1 border-t border-line px-3 @[600px]:px-5">
        <button
          onClick={() => void send()}
          disabled={sending}
          className="mr-2 flex h-9 items-center gap-2 rounded-lg btn-primary px-4 text-[13px] font-medium disabled:opacity-60"
        >
          <Send size={14} />
          {sending ? 'Envoi…' : 'Envoyer'}
          <kbd className="hidden text-[11px] opacity-60 @[480px]:inline">Ctrl ↵</kbd>
        </button>
        <button
          type="button"
          onClick={() => void api.mail.pickFiles().then(addFiles)}
          title="Joindre des fichiers (ou glissez-les ici)"
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] text-fg-2 hover:bg-hover hover:text-fg"
        >
          <Paperclip size={15} /> <span className="hidden @[480px]:inline">Joindre</span>
        </button>
        <button
          type="button"
          onClick={() => void pickImages().then((files) => editor.current && insertImages(editor.current, files))}
          title="Insérer une image dans le message (ou collez-la, ou glissez-la dans le texte)"
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] text-fg-2 hover:bg-hover hover:text-fg"
        >
          <ImagePlus size={15} /> <span className="hidden @[480px]:inline">Image</span>
        </button>
        <button
          type="button"
          onClick={(e) => void openTemplates(e.currentTarget)}
          title="Insérer un modèle, ou enregistrer ce message comme modèle"
          aria-haspopup="menu"
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] text-fg-2 hover:bg-hover hover:text-fg"
        >
          <FileText size={15} /> <span className="hidden @[480px]:inline">Modèles</span>
        </button>
        <span className="ml-auto hidden text-[12px] text-faint @[860px]:inline">Sélectionnez du texte pour le mettre en forme</span>
        <button
          onClick={() => void discard()}
          title="Supprimer le brouillon"
          aria-label="Supprimer le brouillon"
          className="ml-auto grid @[860px]:ml-3 size-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </footer>

      <SelectionToolbar editor={editor} />
      {templateMenu && <Menu anchor={templateMenu.anchor} items={templateMenu.items} onClose={() => setTemplateMenu(null)} minWidth={260} />}
      {filling && (
        <TemplateFill
          template={filling.template}
          fields={filling.fields}
          onApply={(values) => void applyTemplate(filling.template, values)}
          onClose={() => setFilling(null)}
        />
      )}
      {savingTemplate && <SaveTemplateDialog onSave={(name) => void saveAsTemplate(name)} onClose={() => setSavingTemplate(false)} />}

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-10 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-accent-soft backdrop-blur-[1px]">
          <div className="flex items-center gap-2 text-[14px] font-medium text-accent">
            <Upload size={18} /> Déposez pour joindre
          </div>
        </div>
      )}
    </section>
  )
}
