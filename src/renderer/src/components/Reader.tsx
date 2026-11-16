import { Fragment, useEffect, useRef, useState } from 'react'
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
  Paperclip,
  PenLine,
  Reply,
  ReplyAll,
  Star,
  Trash2,
  WifiOff,
  type LucideIcon
} from 'lucide-react'
import type { Address, MessageDetail } from '@shared/types'
import { api, threadKey, useStore } from '../store'
import { dayLabel, displayName, formatAddresses, fullDate, gapLabel, listDate, spanLabel } from '../lib/format'
import { draftToCompose, replyDraft, type ReplyKind } from '../lib/reply'
import { threadMenu } from '../lib/threadActions'
import { useLayout } from '../lib/layout'
import { Avatar } from './Avatar'
import { AttachmentCard } from './AttachmentCard'
import { MessageBody } from './MessageBody'
import { AccountTag } from '../lib/accounts'
import { TriageBanner } from './TriageBanner'
import { Menu } from './ui/Menu'

function ToolButton({
  icon: Icon,
  label,
  onClick,
  active
}: {
  icon: LucideIcon
  label: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  active?: boolean
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
    >
      <Icon size={15} strokeWidth={1.75} className={active ? 'fill-amber-400 text-amber-400' : ''} />
    </button>
  )
}

/** "à Paul Durand, vous +2": who a message went to, short. */
function recipientsShort(m: MessageDetail, me: string): string {
  const names = [...m.to, ...m.cc].map((a) => (a.address.toLowerCase() === me ? 'vous' : displayName(a)))
  if (!names.length) return ''
  return `à ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`
}

/** `top` / `bottom`: dates at each end of the item, for the day gaps around it. */
type TimelineItem =
  | { kind: 'message'; m: MessageDetail; top: number; bottom: number }
  | { kind: 'folded'; messages: MessageDetail[]; top: number; bottom: number }

/**
 * The conversation as it's drawn, newest first: the two latest messages and the original stay
 * visible, a run of collapsed messages in between folds into one row.
 */
function timeline(messages: MessageDetail[], expanded: Set<string>, showAll: boolean): TimelineItem[] {
  const newestFirst = messages.toReversed()
  const items: TimelineItem[] = []
  let run: MessageDetail[] = []
  const one = (m: MessageDetail): TimelineItem => ({ kind: 'message', m, top: m.date, bottom: m.date })
  const flush = (): void => {
    if (run.length >= 2) items.push({ kind: 'folded', messages: run, top: run[0]!.date, bottom: run.at(-1)!.date })
    else items.push(...run.map(one))
    run = []
  }
  newestFirst.forEach((m, i) => {
    const foldable = !showAll && i > 1 && i < newestFirst.length - 1 && !expanded.has(m.id)
    if (foldable) run.push(m)
    else {
      flush()
      items.push(one(m))
    }
  })
  flush()
  return items
}

/** Left column of the conversation timeline: a node (avatar or count) and the rail down to the next one. */
function Rail({ children, line = 'solid', end }: { children?: React.ReactNode; line?: 'solid' | 'dashed'; end?: boolean }) {
  return (
    <div aria-hidden className="flex flex-col items-center">
      {children}
      {!end && (
        <span
          className={`w-0 flex-1 border-l ${line === 'dashed' ? 'border-dashed border-line-strong' : 'border-line'} ${children ? 'mt-1.5' : ''}`}
        />
      )}
    </div>
  )
}

function Message({
  m,
  me,
  expanded,
  last,
  onToggle,
  onReply
}: {
  m: MessageDetail
  me: string
  expanded: boolean
  last: boolean
  onToggle: () => void
  onReply: (m: MessageDetail) => void
}) {
  const { toast } = useStore.getState()
  const mine = m.from.address.toLowerCase() === me
  const name = mine ? 'Vous' : displayName(m.from)
  const to = recipientsShort(m, me)

  return (
    <li data-mine={mine || undefined} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3">
      <Rail end={last}>
        <span className={`rounded-full ${mine ? 'outline-2 outline-offset-2 outline-accent' : ''}`}>
          <Avatar name={displayName(m.from)} seed={m.from.address} size={32} />
        </span>
      </Rail>
      <div className={last ? '' : 'pb-3'}>
        {!expanded ? (
          <button
            onClick={onToggle}
            aria-label={`Déplier le message de ${name}`}
            className={`flex min-h-8 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left transition-colors hover:bg-hover ${mine ? 'bg-accent-soft/40' : ''}`}
          >
            <span className={`w-28 shrink-0 truncate text-[13px] @[600px]:w-36 ${m.unread ? 'font-semibold text-fg' : 'font-medium text-fg-2'}`}>
              {name}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{(m.text ?? '').replace(/\s+/g, ' ').slice(0, 160)}</span>
            {m.attachments.length > 0 && <Paperclip size={13} className="shrink-0 text-muted" aria-label="Pièces jointes" />}
            {m.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Non lu" />}
            <span className="tnum shrink-0 text-[11.5px] text-muted">{listDate(m.date)}</span>
          </button>
        ) : (
          <article
            aria-label={`Message de ${name}`}
            className={`rounded-xl px-3 py-4 shadow-card @[600px]:px-5 ${mine ? 'bg-[color-mix(in_oklch,var(--accent)_7%,var(--surface))]' : 'bg-surface'}`}
          >
            <header className="mb-4 flex items-start gap-3">
              <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left" aria-label={`Replier le message de ${name}`}>
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[13.5px] font-semibold">{name}</span>
                  {!mine && m.from.name && (
                    <span className="hidden truncate text-[12px] text-muted select-text @[520px]:inline">{m.from.address}</span>
                  )}
                  {m.unread && (
                    <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-[10.5px] font-medium text-accent">Nouveau</span>
                  )}
                </span>
                {to && (
                  <span
                    className="block truncate text-[12px] text-muted select-text"
                    title={[formatAddresses(m.to), m.cc.length ? `Cc ${formatAddresses(m.cc)}` : ''].filter(Boolean).join('\n')}
                  >
                    {to}
                  </span>
                )}
              </button>
              <time dateTime={new Date(m.date).toISOString()} className="tnum hidden shrink-0 pt-0.5 text-[12px] text-muted @[640px]:block">
                {fullDate(m.date)}
              </time>
              <time className="tnum shrink-0 pt-0.5 text-[12px] text-muted @[640px]:hidden" title={fullDate(m.date)}>
                {listDate(m.date)}
              </time>
              <ToolButton icon={Reply} label="Répondre à ce message" onClick={() => onReply(m)} />
            </header>
            {m.unavailable ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-4 py-5 text-[13px] text-fg-2">
                <WifiOff size={15} className="shrink-0 text-amber-400" />
                Ce message n’est pas encore téléchargé. Il s’affichera dès le retour de la connexion.
              </div>
            ) : (
              <MessageBody html={m.html} text={m.text} />
            )}
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
        )}
      </div>
    </li>
  )
}

/** Day change between two messages ("mercredi 11 novembre · 2 jours plus tôt"), on a dashed stretch of the rail. */
function DayGap({ newer, older }: { newer: number; older: number }) {
  const gap = gapLabel(newer, older)
  if (!gap) return null
  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3">
      <Rail line="dashed" />
      <p className="pb-3 pl-3 pt-0.5 text-[11.5px] text-muted">
        <span className="font-medium text-fg-2">{dayLabel(older)}</span> · {gap}
      </p>
    </li>
  )
}

/** Older messages folded into one row, with their senders' faces. */
function Folded({ messages, onOpen }: { messages: MessageDetail[]; onOpen: () => void }) {
  const senders = [...new Map(messages.map((m) => [m.from.address.toLowerCase(), m.from])).values()]
  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3">
      <Rail line="dashed">
        <span className="grid size-8 place-items-center rounded-full border border-line-strong text-[11.5px] font-semibold text-fg-2">
          {messages.length}
        </span>
      </Rail>
      <div className="pb-3">
        <button
          onClick={onOpen}
          className="flex min-h-8 w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-[12.5px] text-fg-2 transition-colors hover:bg-hover hover:text-fg"
        >
          <span className="flex -space-x-1.5">
            {senders.slice(0, 4).map((a) => (
              <Avatar key={a.address} name={displayName(a)} seed={a.address} size={18} />
            ))}
          </span>
          {messages.length} messages plus anciens
          {messages.some((m) => m.unread) && <span className="size-1.5 rounded-full bg-accent" aria-label="Dont non lus" />}
        </button>
      </div>
    </li>
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
  // What was loaded, and for which thread: anything for another thread reads as "loading".
  const [loaded, setLoaded] = useState<{ key: string; messages: MessageDetail[] | null; error: string | null } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Conversation (key) whose folded older messages were opened.
  const [showAll, setShowAll] = useState<string | null>(null)
  const [more, setMore] = useState<HTMLElement | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const { single } = useLayout()
  // Reload the open conversation when the connection comes back (bodies may now download).
  const online = !Object.values(useStore((st) => st.offline)).some(Boolean)
  const s = useStore.getState()

  const accountId = thread?.accountId
  const threadId = thread?.threadId
  const key = accountId && threadId ? `${accountId}|${threadId}` : null
  const messages = loaded && loaded.key === key ? loaded.messages : null
  const error = loaded && loaded.key === key ? loaded.error : null

  useEffect(() => {
    if (!accountId || !threadId || !key) return
    let cancelled = false
    let markTimer: ReturnType<typeof setTimeout> | undefined
    api.mail
      .thread(accountId, threadId)
      .then((msgs) => {
        if (cancelled) return
        setLoaded({ key, messages: msgs, error: null })
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
      .catch((e: Error) => !cancelled && setLoaded({ key, messages: null, error: e.message }))
    return () => {
      cancelled = true
      clearTimeout(markTimer)
    }
    // `online` is a trigger: coming back online reloads bodies that couldn't download.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [accountId, threadId, key, online])

  if (!thread) {
    return (
      <section className="@container grid min-w-0 flex-1 place-items-center overflow-hidden">
        <div className="text-center">
          <div aria-hidden className="wordmark mb-6 select-none text-[clamp(72px,14cqw,168px)]">
            Mailbox
          </div>
          <p className="text-[13.5px] font-medium text-fg-2">Aucune conversation ouverte</p>
          <p className="mt-1.5 text-[12.5px] leading-6 text-muted">
            <kbd className="rounded border border-line px-1 text-fg-2">J</kbd> <kbd className="rounded border border-line px-1 text-fg-2">K</kbd> pour
            naviguer · <kbd className="rounded border border-line px-1 text-fg-2">Ctrl K</kbd> pour tout le reste
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
      const email = a.address.toLowerCase()
      if (email && email !== account?.email.toLowerCase() && !people.has(email)) people.set(email, a)
    }
  }
  const allAttachments = (messages ?? []).flatMap((m) => m.attachments.map((a) => ({ m, a })))
  const me = account?.email.toLowerCase() ?? ''
  const participants = new Set((messages ?? []).flatMap((m) => [m.from, ...m.to, ...m.cc].map((a) => a.address.toLowerCase()))).size
  const span = messages && messages.length > 1 ? spanLabel(messages[0]!.date, messages.at(-1)!.date) : null

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
          <ToolButton
            icon={thread.unread ? MailOpen : Mail}
            label={thread.unread ? 'Marquer comme lu (U)' : 'Marquer comme non lu (U)'}
            onClick={() => void s.act([thread], thread.unread ? 'read' : 'unread')}
          />
          <ToolButton
            icon={Star}
            label={thread.flagged ? 'Ne plus suivre (S)' : 'Suivre (S)'}
            active={thread.flagged}
            onClick={() => void s.act([thread], thread.flagged ? 'unflag' : 'flag')}
          />
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
                <span className="mt-1" title={account.email}>
                  <AccountTag account={account} size="md" />
                </span>
              )}
            </div>

            {messages && messages.length > 1 && (
              <p className="-mt-3 mb-5 text-[12.5px] text-muted">
                {[`${messages.length} messages`, `${participants} participants`, span].filter(Boolean).join(' · ')}
              </p>
            )}

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

            {messages && !isDraft && (
              <div className="mb-5 flex flex-wrap gap-2">
                <button onClick={() => reply('reply')} className="flex h-9 items-center gap-2 rounded-lg btn-primary px-4 text-[13px] font-medium">
                  <Reply size={15} /> Répondre
                </button>
                <button
                  onClick={() => reply('replyAll')}
                  className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[13px] text-fg-2 hover:border-line-strong hover:text-fg"
                >
                  <ReplyAll size={15} /> Répondre à tous
                </button>
                <button
                  onClick={() => reply('forward')}
                  className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[13px] text-fg-2 hover:border-line-strong hover:text-fg"
                >
                  <Forward size={15} /> Transférer
                </button>
                {messages.length > 1 && (
                  <button
                    onClick={() => {
                      const all = expanded.size === messages.length
                      setExpanded(all ? new Set([messages.at(-1)!.id]) : new Set(messages.map((m) => m.id)))
                      setShowAll(all ? null : key)
                    }}
                    className="ml-auto flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] text-muted hover:bg-hover hover:text-fg"
                  >
                    <ChevronDown size={14} className={expanded.size === messages.length ? 'rotate-180' : ''} />
                    {expanded.size === messages.length ? 'Tout replier' : 'Tout déplier'}
                  </button>
                )}
              </div>
            )}

            {messages && (
              <ol aria-label="Messages de la conversation">
                {timeline(messages, expanded, showAll === key).map((item, i, items) => (
                  <Fragment key={item.kind === 'folded' ? `folded:${item.messages[0]!.id}` : item.m.id}>
                    {i > 0 && <DayGap newer={items[i - 1]!.bottom} older={item.top} />}
                    {item.kind === 'folded' ? (
                      <Folded messages={item.messages} onOpen={() => setShowAll(key)} />
                    ) : (
                      <Message
                        m={item.m}
                        me={me}
                        last={i === items.length - 1}
                        expanded={expanded.has(item.m.id)}
                        onReply={(msg) => reply('reply', msg)}
                        onToggle={() => {
                          const next = new Set(expanded)
                          if (next.has(item.m.id)) next.delete(item.m.id)
                          else next.add(item.m.id)
                          setExpanded(next)
                        }}
                      />
                    )}
                  </Fragment>
                ))}
              </ol>
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
