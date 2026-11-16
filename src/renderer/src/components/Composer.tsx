import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { ArrowLeft, Bold, Italic, Link2, List, ListOrdered, Paperclip, Quote, Send, Trash2, Underline, Upload, X, type LucideIcon } from 'lucide-react'
import type { OutgoingAttachment, OutgoingMessage } from '@shared/types'
import { api, confirmDialog, useStore, type ComposeDraft } from '../store'
import { escapeHtml, formatAddresses, htmlToText } from '../lib/format'
import { AttachmentCard } from './AttachmentCard'
import { RecipientInput, isValidAddress } from './RecipientInput'
import { Select } from './ui/Controls'
import { useLayout } from '../lib/layout'
import { accountLabel } from '../lib/accounts'

const AUTOSAVE_MS = 2500
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

function FormatButton({ icon: Icon, label, onClick, active }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid size-7 place-items-center rounded-md ${active ? 'bg-accent-soft text-accent' : 'text-fg-2 hover:bg-hover hover:text-fg'}`}
    >
      <Icon size={14} strokeWidth={2} />
    </button>
  )
}

/** Formatting bar that floats above the current text selection. */
function SelectionToolbar({ editor }: { editor: React.RefObject<HTMLDivElement | null> }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [, force] = useState(0)
  const [link, setLink] = useState<{ url: string; range: Range } | null>(null)

  useEffect(() => {
    const onChange = (): void => {
      if (link) return
      const sel = window.getSelection()
      const el = editor.current
      if (!sel || sel.isCollapsed || !sel.rangeCount || !el || !el.contains(sel.anchorNode)) {
        setPos(null)
        return
      }
      const r = sel.getRangeAt(0).getBoundingClientRect()
      setPos({ x: r.left + r.width / 2, y: r.top })
      force((n) => n + 1)
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [editor, link])

  if (!pos) return null
  const cmd = (name: string, value?: string): void => {
    document.execCommand(name, false, value)
    force((n) => n + 1)
  }
  const state = (name: string): boolean => document.queryCommandState(name)

  return (
    <div
      className="pop-in fixed z-[65] flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-line glass p-1"
      style={{ left: pos.x, top: pos.y - 8 }}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      {link ? (
        <input
          autoFocus
          value={link.url}
          onChange={(e) => setLink({ ...link, url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setLink(null)
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              const url = link.url.trim()
              const sel = window.getSelection()
              sel?.removeAllRanges()
              sel?.addRange(link.range)
              if (/^(https?:\/\/|mailto:)./i.test(url)) document.execCommand('createLink', false, url)
              setLink(null)
            }
          }}
          onBlur={() => setLink(null)}
          placeholder="https://"
          className="h-7 w-60 rounded-md bg-panel px-2 text-[12.5px] text-fg focus:outline-none"
        />
      ) : (
        <>
          <FormatButton icon={Bold} label="Gras (Ctrl B)" active={state('bold')} onClick={() => cmd('bold')} />
          <FormatButton icon={Italic} label="Italique (Ctrl I)" active={state('italic')} onClick={() => cmd('italic')} />
          <FormatButton icon={Underline} label="Souligné (Ctrl U)" active={state('underline')} onClick={() => cmd('underline')} />
          <span className="mx-0.5 h-4 w-px bg-line" />
          <FormatButton
            icon={Link2}
            label="Lien"
            onClick={() => {
              const sel = window.getSelection()
              if (sel?.rangeCount) setLink({ url: 'https://', range: sel.getRangeAt(0).cloneRange() })
            }}
          />
          <FormatButton icon={List} label="Liste à puces" active={state('insertUnorderedList')} onClick={() => cmd('insertUnorderedList')} />
          <FormatButton icon={ListOrdered} label="Liste numérotée" active={state('insertOrderedList')} onClick={() => cmd('insertOrderedList')} />
          <FormatButton icon={Quote} label="Citation" onClick={() => cmd('formatBlock', 'blockquote')} />
        </>
      )}
    </div>
  )
}

function isEmpty(d: ComposeDraft, html: string): boolean {
  return !d.to.length && !d.cc.length && !d.bcc.length && !d.subject.trim() && !d.attachments.length && !htmlToText(html).replace(/^--\s*$[\s\S]*/m, '').trim()
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

  // Latest state for timers and unmount, without re-subscribing effects.
  const latest = useRef(draft)
  latest.current = draft
  const dirty = useRef(false)
  const done = useRef(false)
  const inflight = useRef<Promise<void> | null>(null)
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
    setSaving(true)
    const job = api.mail
      .saveDraft(message(d))
      .then((res) => {
        if (!res) return
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
    const signature = account?.signature && draft.kind !== 'draft' ? `<p><br></p><p>-- <br>${escapeHtml(account.signature).replace(/\n/g, '<br>')}</p>` : ''
    // Quoted mail comes from strangers: sanitize before it lands in a live contentEditable.
    const body = DOMPurify.sanitize(draft.html, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'script'] })
    if (editor.current) editor.current.innerHTML = draft.html ? (signature ? body.replace('<p><br></p>', `<p><br></p>${signature}`) : body) : signature
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
    if (!d.subject.trim() && !(await confirmDialog({ title: 'Envoyer sans objet ?', body: 'Ce message n’a pas d’objet.', confirmLabel: 'Envoyer quand même', cancelLabel: 'Ajouter un objet' }))) return
    setSending(true)
    clearTimeout(timer.current)
    if (inflight.current) await inflight.current
    try {
      await api.mail.send(message(latest.current))
      done.current = true
      closeComposer()
      toast('Message envoyé')
    } catch (err) {
      toast((err as Error).message, 'error')
      setSending(false)
    }
  }

  const discard = async (): Promise<void> => {
    clearTimeout(timer.current)
    if (inflight.current) await inflight.current
    // Restored as a 'draft' so the signature isn't added a second time.
    const snapshot: ComposeDraft = { ...latest.current, kind: 'draft', html: editor.current?.innerHTML ?? latest.current.html, key: crypto.randomUUID() }
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
    <section
      className="@container relative flex min-w-0 flex-1 flex-col"
      onKeyDown={(e) => {
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
        const paths = [...e.dataTransfer.files].map((f) => api.app.pathForFile(f)).filter(Boolean)
        void api.mail.fileInfo(paths).then(addFiles)
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 @[600px]:px-6">
        {single && (
          <button onClick={close} aria-label="Retour" title="Retour (garde le brouillon)" className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
            <ArrowLeft size={16} />
          </button>
        )}
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{TITLES[draft.kind]}</h2>
        <span className="ml-1 hidden truncate text-[12px] text-muted @[480px]:inline">
          {saving ? 'Enregistrement…' : savedAt ? `Brouillon enregistré à ${new Date(savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
        <button onClick={close} title="Fermer et garder le brouillon (Échap)" aria-label="Fermer" className="ml-auto grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {accounts.length > 1 && (
          <Row label="De">
            <Select
              ariaLabel="Compte d’envoi"
              value={draft.accountId}
              onChange={(v) => set('accountId', v)}
              options={accounts.map((a) => ({ value: a.id, label: `${accountLabel(a)} · ${a.name} <${a.email}>`, swatch: a.color }))}
              className="max-w-[420px] flex-1"
            />
          </Row>
        )}
        <Row
          label="À"
          trailing={
            !showCc && (
              <button type="button" onClick={() => setShowCc(true)} className="shrink-0 rounded-md px-2 py-1 text-[12.5px] text-muted hover:bg-hover hover:text-fg">
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
          <div ref={editor} contentEditable className="prose-compose" data-placeholder="Écrivez votre message…" spellCheck onInput={touch} />
        </div>

        {draft.attachments.length > 0 && (
          <div className="flex flex-wrap gap-3 px-4 pb-6 @[600px]:px-6">
            {draft.attachments.map((a, i) => (
              <AttachmentCard
                key={`${a.kind === 'file' ? a.path : a.messageId + a.attachmentId}-${i}`}
                name={a.name}
                size={a.size}
                onRemove={() => set('attachments', draft.attachments.filter((_, j) => j !== i))}
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
        <span className="ml-auto hidden text-[12px] text-faint @[720px]:inline">Sélectionnez du texte pour le mettre en forme</span>
        <button onClick={() => void discard()} title="Supprimer le brouillon" aria-label="Supprimer le brouillon" className="ml-auto grid @[720px]:ml-3 size-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-danger">
          <Trash2 size={15} />
        </button>
      </footer>

      <SelectionToolbar editor={editor} />

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
