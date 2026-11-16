import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  FolderInput,
  Forward,
  Mail,
  MailOpen,
  MoreHorizontal,
  OctagonAlert,
  PenLine,
  Reply,
  ReplyAll,
  Star,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import type { Address, MessageDetail } from '@shared/types'
import { api, threadKey, useStore } from '../store'
import { displayName, formatAddresses, fullDate, listDate } from '../lib/format'
import { draftToCompose, replyDraft, type ReplyKind } from '../lib/reply'
import { threadMenu } from '../lib/threadActions'
import { useLayout } from '../lib/layout'
import { Avatar } from './Avatar'
import { AttachmentCard } from './AttachmentCard'
import { MessageBody } from './MessageBody'
import { TriageBanner } from './TriageBanner'
import { Menu } from './ui/Menu'

function ToolButton({ icon: Icon, label, onClick, active }: { icon: LucideIcon; label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; active?: boolean }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg">
      <Icon size={15} strokeWidth={1.75} className={active ? 'fill-amber-400 text-amber-400' : ''} />
    </button>
  )
}

function Message({ m, expanded, onToggle, onReply }: { m: MessageDetail; expanded: boolean; onToggle: () => void; onReply: (m: MessageDetail) => void }) {
  const { toast } = useStore.getState()
  const name = displayName(m.from)

  if (!expanded) {
    return (
      <button onClick={onToggle} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-hover">
        <Avatar name={name} seed={m.from.address} size={28} />
        <span className="w-40 shrink-0 truncate text-[13px] font-medium text-fg-2">{name}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{(m.text ?? '').replace(/\s+/g, ' ').slice(0, 160)}</span>
        <span className="tnum shrink-0 text-[11.5px] text-muted">{listDate(m.date)}</span>
      </button>
    )
  }

  const recipients = [m.to.length ? `À ${formatAddresses(m.to)}` : '', m.cc.length ? `Cc ${formatAddresses(m.cc)}` : ''].filter(Boolean)

  return (
    <article className="rounded-xl bg-surface px-3 py-4 shadow-card @[600px]:px-5">
      <header className="mb-4 flex items-start gap-3">
        <button onClick={onToggle} className="shrink-0" aria-label="Replier le message">
          <Avatar name={name} seed={m.from.address} size={36} />
        </button>
        <div className="min-w-0 flex-1" onClick={onToggle}>
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13.5px] font-semibold">{name}</span>
            {m.from.name && <span className="truncate text-[12px] text-muted select-text">{m.from.address}</span>}
          </div>
          <div className="truncate text-[12px] text-muted select-text" title={recipients.join('\n')}>
            {recipients.join(' · ')}
          </div>
        </div>
        <time className="tnum hidden shrink-0 pt-0.5 text-[12px] text-muted @[640px]:block">{fullDate(m.date)}</time>
        <time className="tnum shrink-0 pt-0.5 text-[12px] text-muted @[640px]:hidden" title={fullDate(m.date)}>
          {listDate(m.date)}
        </time>
        <ToolButton icon={Reply} label="Répondre à ce message" onClick={() => onReply(m)} />
      </header>
      <MessageBody html={m.html} text={m.text} allowRemoteByDefault={useStore.getState().settings?.remoteImages === 'allow'} />
      {m.attachments.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2.5">
          {m.attachments.map((a) => (
            <AttachmentCard
              key={a.id}
              name={a.filename}
              size={a.size}
              onOpen={() => api.mail.openAttachment(m.id, a.id).catch((e: Error) => toast(e.message, 'error'))}
              onSave={() => api.mail.saveAttachment(m.id, a.id).catch((e: Error) => toast(e.message, 'error'))}
            />
          ))}
        </div>
      )}
    </article>
  )
}

function People({ people, accountId }: { people: Address[]; accountId: string }) {
  const compose = useStore((s) => s.compose)
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-medium text-muted">Participants</h3>
      <div className="space-y-0.5">
        {people.map((p) => (
          <button
            key={p.address}
            onClick={() => compose({ accountId, to: [p] })}
            title={`Écrire à ${p.address}`}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
          >
            <Avatar name={displayName(p)} seed={p.address} size={28} />
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium">{displayName(p)}</span>
              <span className="block truncate text-[11.5px] text-muted">{p.address}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function Reader() {
  const thread = useStore((s) => s.threads.find((t) => threadKey(t) === s.selected))
  const accounts = useStore((s) => s.accounts)
  const [messages, setMessages] = useState<MessageDetail[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState<HTMLElement | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const { single } = useLayout()
  const s = useStore.getState()

  const accountId = thread?.accountId
  const threadId = thread?.threadId

  useEffect(() => {
    if (!accountId || !threadId) {
      setMessages(null)
      return
    }
    let cancelled = false
    let markTimer: ReturnType<typeof setTimeout> | undefined
    setMessages(null)
    setError(null)
    api.mail
      .thread(accountId, threadId)
      .then((msgs) => {
        if (cancelled) return
        setMessages(msgs)
        setExpanded(new Set(msgs.filter((m, i) => m.unread || i === msgs.length - 1).map((m) => m.id)))
        scroller.current?.scrollTo({ top: 0 })
        const delay = useStore.getState().settings?.markReadDelay ?? 0
        if (delay >= 0) {
          markTimer = setTimeout(() => {
            const current = useStore.getState().threads.find((t) => t.accountId === accountId && t.threadId === threadId)
            if (current?.unread && current.folderRole !== 'drafts') void useStore.getState().act([current], 'read')
          }, delay)
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
      clearTimeout(markTimer)
    }
  }, [accountId, threadId])

  if (!thread) {
    return (
      <section className="@container grid min-w-0 flex-1 place-items-center overflow-hidden">
        <div className="text-center">
          <div aria-hidden className="wordmark mb-6 select-none text-[clamp(72px,14cqw,168px)]">
            Mailbox
          </div>
          <p className="text-[13.5px] font-medium text-fg-2">Aucune conversation ouverte</p>
          <p className="mt-1.5 text-[12.5px] leading-6 text-muted">
            <kbd className="rounded border border-line px-1 text-fg-2">J</kbd> <kbd className="rounded border border-line px-1 text-fg-2">K</kbd> pour naviguer ·{' '}
            <kbd className="rounded border border-line px-1 text-fg-2">Ctrl K</kbd> pour tout le reste
          </p>
        </div>
      </section>
    )
  }

  const reply = (kind: ReplyKind, m?: MessageDetail): void => {
    void replyDraft(thread, kind, m ?? messages?.at(-1))
      .then((d) => s.compose(d))
      .catch((e: Error) => s.toast(e.message, 'error'))
  }

  const isDraft = thread.folderRole === 'drafts'
  const account = accounts.find((a) => a.id === thread.accountId)
  const people = new Map<string, Address>()
  for (const m of messages ?? []) {
    for (const a of [m.from, ...m.to, ...m.cc]) {
      const key = a.address.toLowerCase()
      if (key && key !== account?.email.toLowerCase() && !people.has(key)) people.set(key, a)
    }
  }
  const allAttachments = (messages ?? []).flatMap((m) => m.attachments.map((a) => ({ m, a })))

  return (
    <section className="@container flex min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line px-3">
        {single && (
          <>
            <ToolButton icon={ArrowLeft} label="Retour à la liste (Échap)" onClick={() => s.select(null)} />
            <span className="mx-1 h-4 w-px bg-line" />
          </>
        )}
        <ToolButton icon={Archive} label="Archiver (E)" onClick={() => void s.act([thread], 'archive')} />
        <span className="hidden @[520px]:contents">
          <ToolButton icon={OctagonAlert} label="Indésirable (!)" onClick={() => void s.act([thread], 'junk')} />
        </span>
        <ToolButton icon={Trash2} label="Supprimer (#)" onClick={() => void s.act([thread], 'trash')} />
        <span className="hidden @[520px]:contents">
          <span className="mx-1 h-4 w-px bg-line" />
          <ToolButton icon={thread.unread ? MailOpen : Mail} label={thread.unread ? 'Marquer comme lu (U)' : 'Marquer comme non lu (U)'} onClick={() => void s.act([thread], thread.unread ? 'read' : 'unread')} />
          <ToolButton icon={Star} label={thread.flagged ? 'Ne plus suivre (S)' : 'Suivre (S)'} active={thread.flagged} onClick={() => void s.act([thread], thread.flagged ? 'unflag' : 'flag')} />
          <ToolButton icon={FolderInput} label="Déplacer vers… (V)" onClick={() => s.openMovePicker([thread])} />
        </span>
        <span className="flex-1" />
        <span className="hidden @[420px]:contents">
          <ToolButton icon={Reply} label="Répondre (R)" onClick={() => reply('reply')} />
          <ToolButton icon={ReplyAll} label="Répondre à tous (A)" onClick={() => reply('replyAll')} />
          <ToolButton icon={Forward} label="Transférer (F)" onClick={() => reply('forward')} />
        </span>
        <ToolButton icon={MoreHorizontal} label="Plus d’actions" onClick={(e) => setMore(e.currentTarget)} />
        {more && <Menu anchor={more} align="end" items={threadMenu([thread])} onClose={() => setMore(null)} minWidth={230} />}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1180px] gap-8 px-4 pb-16 pt-6 @[600px]:px-6">
          <div className="min-w-0 flex-1">
            <div className="mb-5 flex items-start gap-3">
              <h2 className="min-w-0 flex-1 text-[19px] font-semibold @[600px]:text-[21px] leading-tight tracking-[-0.02em] select-text">
                {messages?.[0]?.subject || thread.subject || '(sans objet)'}
              </h2>
              {account && accounts.length > 1 && (
                <span className="mt-1 flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-[11.5px] text-fg-2">
                  <span className="size-2 rounded-[3px]" style={{ background: account.color }} />
                  {account.name}
                </span>
              )}
            </div>

            {messages && !isDraft && (thread.category === 'newsletters' || thread.category === 'notifications') && (
              <TriageBanner thread={thread} messageId={messages.at(-1)!.id} />
            )}

            {isDraft && messages && (
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                <PenLine size={16} className="text-muted" />
                <span className="flex-1 text-[13px] text-fg-2">Ce brouillon n’a pas encore été envoyé.</span>
                <button
                  onClick={() => messages.at(-1) && s.compose(draftToCompose(messages.at(-1)!))}
                  className="h-8 rounded-lg btn-primary px-3.5 text-[12.5px] font-medium"
                >
                  Reprendre le brouillon
                </button>
              </div>
            )}

            {error && <p className="text-[13px] text-danger">{error}</p>}
            {!messages && !error && (
              <div className="space-y-3">
                <div className="h-24 animate-pulse rounded-xl bg-hover" />
                <div className="h-48 animate-pulse rounded-xl bg-hover/60" />
              </div>
            )}

            <div className="space-y-2">
              {messages?.map((m) => (
                <Message
                  key={m.id}
                  m={m}
                  expanded={expanded.has(m.id)}
                  onReply={(msg) => reply('reply', msg)}
                  onToggle={() => {
                    const next = new Set(expanded)
                    if (next.has(m.id)) next.delete(m.id)
                    else next.add(m.id)
                    setExpanded(next)
                  }}
                />
              ))}
            </div>

            {messages && !isDraft && (
              <div className="mt-5 flex flex-wrap gap-2">
                <button onClick={() => reply('reply')} className="flex h-9 items-center gap-2 rounded-lg btn-primary px-4 text-[13px] font-medium">
                  <Reply size={15} /> Répondre
                </button>
                <button onClick={() => reply('replyAll')} className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[13px] text-fg-2 hover:border-line-strong hover:text-fg">
                  <ReplyAll size={15} /> Répondre à tous
                </button>
                <button onClick={() => reply('forward')} className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[13px] text-fg-2 hover:border-line-strong hover:text-fg">
                  <Forward size={15} /> Transférer
                </button>
                {messages.length > 1 && (
                  <button
                    onClick={() => setExpanded(expanded.size === messages.length ? new Set([messages.at(-1)!.id]) : new Set(messages.map((m) => m.id)))}
                    className="ml-auto flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] text-muted hover:bg-hover hover:text-fg"
                  >
                    <ChevronDown size={14} className={expanded.size === messages.length ? 'rotate-180' : ''} />
                    {expanded.size === messages.length ? 'Tout replier' : 'Tout déplier'}
                  </button>
                )}
              </div>
            )}
          </div>

          {messages && (people.size > 0 || allAttachments.length > 0) && (
            <aside className="hidden w-60 shrink-0 space-y-6 pt-1 @[980px]:block">
              {people.size > 0 && <People people={[...people.values()].slice(0, 8)} accountId={thread.accountId} />}
              {allAttachments.length > 0 && (
                <div>
                  <h3 className="mb-2 text-[12px] font-medium text-muted">Pièces jointes · {allAttachments.length}</h3>
                  <div className="space-y-0.5">
                    {allAttachments.map(({ m, a }) => (
                      <button
                        key={`${m.id}:${a.id}`}
                        onClick={() => api.mail.openAttachment(m.id, a.id).catch((e: Error) => s.toast(e.message, 'error'))}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-hover"
                      >
                        <span className="truncate">{a.filename}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </section>
  )
}
