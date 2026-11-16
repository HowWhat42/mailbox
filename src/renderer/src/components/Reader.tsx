import { useEffect, useState } from 'react'
import { Archive, Download, Forward, Mail, MailOpen, OctagonAlert, Paperclip, Reply, ReplyAll, Star, Trash2, type LucideIcon } from 'lucide-react'
import type { MessageDetail, MessageAction } from '@shared/types'
import { api, threadKey, useStore } from '../store'
import { avatarColor, displayName, fileSize, formatAddresses, fullDate, initials, listDate } from '../lib/format'
import { replyDraft, type ReplyKind } from '../lib/reply'
import { MessageBody } from './MessageBody'

function ToolButton({ icon: Icon, label, onClick, active }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="no-drag grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
    >
      <Icon size={15} strokeWidth={1.75} className={active ? 'fill-amber-400 text-amber-400' : ''} />
    </button>
  )
}

function Avatar({ name, seed }: { name: string; seed: string }) {
  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold text-white"
      style={{ background: avatarColor(seed) }}
    >
      {initials(name)}
    </span>
  )
}

function Message({ m, expanded, onToggle }: { m: MessageDetail; expanded: boolean; onToggle: () => void }) {
  const { toast } = useStore.getState()
  const name = displayName(m.from)

  if (!expanded) {
    return (
      <button onClick={onToggle} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-hover/60">
        <Avatar name={name} seed={m.from.address} />
        <span className="w-40 shrink-0 truncate text-[13px] font-medium text-fg-2">{name}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{(m.text ?? '').replace(/\s+/g, ' ').slice(0, 160)}</span>
        <span className="tnum shrink-0 text-[11.5px] text-muted">{listDate(m.date)}</span>
      </button>
    )
  }

  const recipients = [
    m.to.length ? `À : ${formatAddresses(m.to)}` : '',
    m.cc.length ? `Cc : ${formatAddresses(m.cc)}` : ''
  ].filter(Boolean)

  return (
    <article className="px-3 py-3">
      <header onClick={onToggle} className="mb-3 flex cursor-default items-start gap-3">
        <Avatar name={name} seed={m.from.address} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13.5px] font-semibold">{name}</span>
            {m.from.name && <span className="truncate text-[12px] text-muted">{m.from.address}</span>}
          </div>
          <div className="truncate text-[12px] text-muted select-text" title={recipients.join('\n')}>
            {recipients.join('  ')}
          </div>
        </div>
        <time className="tnum shrink-0 pt-0.5 text-[12px] text-muted" title={fullDate(m.date)}>
          {fullDate(m.date)}
        </time>
      </header>
      <MessageBody html={m.html} text={m.text} />
      {m.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <div key={a.id} className="group flex items-center gap-2 rounded-md border border-line bg-raised py-1.5 pl-2.5 pr-1.5 text-[12.5px]">
              <Paperclip size={13} className="text-muted" />
              <button
                onClick={() => api.mail.openAttachment(m.id, a.id).catch((e: Error) => toast(e.message, 'error'))}
                className="max-w-56 truncate hover:underline"
                title={`Ouvrir ${a.filename}`}
              >
                {a.filename}
              </button>
              <span className="tnum text-[11.5px] text-muted">{fileSize(a.size)}</span>
              <button
                onClick={() => api.mail.saveAttachment(m.id, a.id).catch((e: Error) => toast(e.message, 'error'))}
                title="Enregistrer sous…"
                className="grid size-6 place-items-center rounded text-muted hover:bg-hover hover:text-fg"
              >
                <Download size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

export function Reader() {
  const selected = useStore((s) => s.selected)
  const thread = useStore((s) => s.threads.find((t) => threadKey(t) === s.selected))
  const [messages, setMessages] = useState<MessageDetail[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const accountId = thread?.accountId
  const threadId = thread?.threadId

  useEffect(() => {
    if (!accountId || !threadId) {
      setMessages(null)
      return
    }
    let cancelled = false
    setMessages(null)
    setError(null)
    api.mail
      .thread(accountId, threadId)
      .then((msgs) => {
        if (cancelled) return
        setMessages(msgs)
        setExpanded(new Set(msgs.filter((m, i) => m.unread || i === msgs.length - 1).map((m) => m.id)))
        const current = useStore.getState().threads.find((t) => t.accountId === accountId && t.threadId === threadId)
        if (current?.unread) void useStore.getState().act(current, 'read')
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [accountId, threadId])

  if (!thread) {
    return (
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="drag h-10 shrink-0" />
        <div className="grid flex-1 place-items-center">
          <div className="text-center text-[12.5px] leading-6 text-muted">
            <Mail size={22} strokeWidth={1.5} className="mx-auto mb-3 text-faint" />
            <p>
              <kbd className="text-fg-2">J</kbd> / <kbd className="text-fg-2">K</kbd> pour naviguer, <kbd className="text-fg-2">E</kbd> pour archiver,{' '}
              <kbd className="text-fg-2">R</kbd> pour répondre
            </p>
            <p>
              <kbd className="text-fg-2">Ctrl K</kbd> ouvre toutes les commandes
            </p>
          </div>
        </div>
      </section>
    )
  }

  const act = (action: MessageAction): void => void useStore.getState().act(thread, action)
  const reply = (kind: ReplyKind): void => {
    void replyDraft(thread, kind, messages?.at(-1)).then((d) => useStore.getState().compose(d))
  }

  return (
    <section key={selected} className="flex min-w-0 flex-1 flex-col">
      <div className="drag flex h-10 shrink-0 items-center gap-0.5 border-b border-line px-3 pr-[150px]">
        <ToolButton icon={Archive} label="Archiver (E)" onClick={() => act('archive')} />
        <ToolButton icon={Trash2} label="Supprimer (#)" onClick={() => act('trash')} />
        <ToolButton icon={OctagonAlert} label="Indésirable (!)" onClick={() => act('junk')} />
        <span className="mx-1.5 h-4 w-px bg-line" />
        <ToolButton icon={thread.unread ? MailOpen : Mail} label={thread.unread ? 'Marquer comme lu (U)' : 'Marquer comme non lu (U)'} onClick={() => act(thread.unread ? 'read' : 'unread')} />
        <ToolButton icon={Star} label={thread.flagged ? 'Ne plus suivre (S)' : 'Suivre (S)'} active={thread.flagged} onClick={() => act(thread.flagged ? 'unflag' : 'flag')} />
        <span className="mx-1.5 h-4 w-px bg-line" />
        <ToolButton icon={Reply} label="Répondre (R)" onClick={() => reply('reply')} />
        <ToolButton icon={ReplyAll} label="Répondre à tous (A)" onClick={() => reply('replyAll')} />
        <ToolButton icon={Forward} label="Transférer (F)" onClick={() => reply('forward')} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px] px-6 pb-16 pt-6">
          <h2 className="mb-4 px-3 text-[20px] font-semibold leading-tight tracking-[-0.02em] select-text">{messages?.[0]?.subject || thread.subject || '(sans objet)'}</h2>
          {error && <p className="px-3 text-[13px] text-danger">{error}</p>}
          {!messages && !error && <p className="px-3 text-[13px] text-muted">Chargement du message…</p>}
          <div className="divide-y divide-line">
            {messages?.map((m) => (
              <Message
                key={m.id}
                m={m}
                expanded={expanded.has(m.id)}
                onToggle={() => {
                  const next = new Set(expanded)
                  if (next.has(m.id)) next.delete(m.id)
                  else next.add(m.id)
                  setExpanded(next)
                }}
              />
            ))}
          </div>
          {messages && (
            <div className="mt-4 flex gap-2 px-3">
              <button onClick={() => reply('reply')} className="flex h-8 items-center gap-2 rounded-md border border-line px-3 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg">
                <Reply size={14} /> Répondre
              </button>
              <button onClick={() => reply('replyAll')} className="flex h-8 items-center gap-2 rounded-md border border-line px-3 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg">
                <ReplyAll size={14} /> Répondre à tous
              </button>
              <button onClick={() => reply('forward')} className="flex h-8 items-center gap-2 rounded-md border border-line px-3 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg">
                <Forward size={14} /> Transférer
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
