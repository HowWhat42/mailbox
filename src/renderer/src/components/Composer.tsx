import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { Bold, Italic, Link2, List, ListOrdered, Paperclip, Send, Trash2, X, type LucideIcon } from 'lucide-react'
import { api, useStore, type ComposeDraft } from '../store'
import { escapeHtml, fileSize, htmlToText } from '../lib/format'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex h-9 items-center gap-3 border-b border-line px-4">
      <span className="w-12 shrink-0 text-[12.5px] text-muted">{label}</span>
      {children}
    </label>
  )
}

const inputCls = 'h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-faint focus:outline-none'

function FormatButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="grid size-7 place-items-center rounded text-muted hover:bg-hover hover:text-fg"
    >
      <Icon size={14} strokeWidth={1.75} />
    </button>
  )
}

export function Composer({ draft }: { draft: ComposeDraft }) {
  const accounts = useStore((s) => s.accounts)
  const { closeComposer, toast } = useStore.getState()
  const [d, setD] = useState(draft)
  const [showCc, setShowCc] = useState(!!(draft.cc || draft.bcc))
  const [sending, setSending] = useState(false)
  const [link, setLink] = useState<{ url: string; range: Range | null } | null>(null)
  const editor = useRef<HTMLDivElement>(null)
  const firstField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const account = accounts.find((a) => a.id === draft.accountId)
    const signature = account?.signature ? `<p><br></p><p>-- <br>${escapeHtml(account.signature).replace(/\n/g, '<br>')}</p>` : ''
    // Quoted mail comes from strangers: sanitize before it lands in a live contentEditable.
    const quoted = DOMPurify.sanitize(draft.html, { FORBID_TAGS: ['style', 'form', 'input', 'button'] })
    if (editor.current) editor.current.innerHTML = draft.html ? quoted.replace('<p><br></p>', `<p><br></p>${signature}`) : signature
    if (draft.to) {
      editor.current?.focus()
      const sel = window.getSelection()
      sel?.setPosition(editor.current, 0)
    } else firstField.current?.focus()
    // Only on mount: the draft is the initial state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = <K extends keyof ComposeDraft>(key: K, value: ComposeDraft[K]): void => setD((prev) => ({ ...prev, [key]: value }))

  const cmd = (name: string, value?: string): void => {
    editor.current?.focus()
    document.execCommand(name, false, value)
  }

  const hasContent = (): boolean => !!(d.to || d.subject || htmlToText(editor.current?.innerHTML ?? '').replace(/^--[\s\S]*$/m, '').trim() || d.attachments.length)

  const discard = (): void => {
    if (!hasContent() || window.confirm('Abandonner ce brouillon ?')) closeComposer()
  }

  const attach = async (): Promise<void> => {
    const files = await api.mail.pickFiles()
    if (files.length) set('attachments', [...d.attachments, ...files])
  }

  const send = async (): Promise<void> => {
    if (sending) return
    if (!d.to.trim()) {
      toast('Ajoutez au moins un destinataire.', 'error')
      firstField.current?.focus()
      return
    }
    const html = editor.current?.innerHTML ?? ''
    if (!d.subject.trim() && !window.confirm('Envoyer sans objet ?')) return
    setSending(true)
    try {
      await api.mail.send({
        accountId: d.accountId,
        to: d.to,
        cc: d.cc,
        bcc: d.bcc,
        subject: d.subject,
        html,
        text: htmlToText(html),
        inReplyTo: d.inReplyTo,
        references: d.references,
        attachments: d.attachments.map((a) => ({ path: a.path }))
      })
      closeComposer()
      toast('Message envoyé')
    } catch (err) {
      toast((err as Error).message, 'error')
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && discard()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void send()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          discard()
        }
      }}
    >
      <div className="pop-in flex max-h-full w-full max-w-[760px] flex-col overflow-hidden rounded-xl bg-raised shadow-pop">
        <div className="flex h-11 items-center border-b border-line px-4">
          <h2 className="text-[13.5px] font-semibold">{d.inReplyTo ? 'Réponse' : d.subject.startsWith('Fwd:') ? 'Transfert' : 'Nouveau message'}</h2>
          <button onClick={discard} title="Fermer (Échap)" className="ml-auto grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
            <X size={15} />
          </button>
        </div>

        {accounts.length > 1 && (
          <Field label="De">
            <select value={d.accountId} onChange={(e) => set('accountId', e.target.value)} className={`${inputCls} cursor-pointer`}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="bg-raised">
                  {a.name} &lt;{a.email}&gt;
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="À">
          <input ref={firstField} value={d.to} onChange={(e) => set('to', e.target.value)} className={inputCls} placeholder="nom@exemple.fr, …" />
          {!showCc && (
            <button type="button" onClick={() => setShowCc(true)} className="text-[12px] text-muted hover:text-fg">
              Cc / Cci
            </button>
          )}
        </Field>
        {showCc && (
          <>
            <Field label="Cc">
              <input value={d.cc} onChange={(e) => set('cc', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Cci">
              <input value={d.bcc} onChange={(e) => set('bcc', e.target.value)} className={inputCls} />
            </Field>
          </>
        )}
        <Field label="Objet">
          <input value={d.subject} onChange={(e) => set('subject', e.target.value)} className={`${inputCls} font-medium`} />
        </Field>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div ref={editor} contentEditable className="prose-compose" data-placeholder="Écrivez votre message…" spellCheck />
        </div>

        {d.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
            {d.attachments.map((a, i) => (
              <span key={a.path + i} className="flex items-center gap-2 rounded-md border border-line bg-panel py-1 pl-2 pr-1 text-[12px]">
                <Paperclip size={12} className="text-muted" />
                <span className="max-w-48 truncate">{a.name}</span>
                <span className="tnum text-muted">{fileSize(a.size)}</span>
                <button
                  onClick={() => set('attachments', d.attachments.filter((_, j) => j !== i))}
                  className="grid size-5 place-items-center rounded text-muted hover:bg-hover hover:text-fg"
                  title="Retirer"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex h-12 items-center gap-0.5 border-t border-line px-3">
          <button
            onClick={send}
            disabled={sending}
            className="mr-2 flex h-8 items-center gap-2 rounded-md bg-accent px-3.5 text-[13px] font-medium text-accent-fg hover:brightness-110 disabled:opacity-60"
          >
            <Send size={14} />
            {sending ? 'Envoi…' : 'Envoyer'}
            <kbd className="text-[11px] opacity-60">Ctrl ↵</kbd>
          </button>
          <FormatButton icon={Bold} label="Gras (Ctrl B)" onClick={() => cmd('bold')} />
          <FormatButton icon={Italic} label="Italique (Ctrl I)" onClick={() => cmd('italic')} />
          <FormatButton
            icon={Link2}
            label="Lien"
            onClick={() => {
              const sel = window.getSelection()
              setLink({ url: 'https://', range: sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null })
            }}
          />
          {link && (
            <input
              autoFocus
              value={link.url}
              onChange={(e) => setLink({ ...link, url: e.target.value })}
              onBlur={() => setLink(null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setLink(null)
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const url = link.url.trim()
                  if (/^(https?:\/\/|mailto:)./i.test(url) && link.range) {
                    const sel = window.getSelection()
                    sel?.removeAllRanges()
                    sel?.addRange(link.range)
                    if (link.range.collapsed) document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`)
                    else document.execCommand('createLink', false, url)
                  }
                  setLink(null)
                }
              }}
              className="mx-1 h-7 w-56 rounded border border-line-strong bg-panel px-2 text-[12px] focus:outline-none"
              placeholder="https://"
            />
          )}
          <FormatButton icon={List} label="Liste à puces" onClick={() => cmd('insertUnorderedList')} />
          <FormatButton icon={ListOrdered} label="Liste numérotée" onClick={() => cmd('insertOrderedList')} />
          <FormatButton icon={Paperclip} label="Joindre des fichiers" onClick={attach} />
          <button onClick={discard} title="Abandonner" className="ml-auto grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-danger">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
