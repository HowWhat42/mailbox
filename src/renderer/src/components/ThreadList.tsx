import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Archive, Paperclip, Search, Star, Trash2, X } from 'lucide-react'
import type { ThreadSummary } from '@shared/types'
import { threadKey, useStore } from '../store'
import { displayName, listDate, ROLE_LABEL } from '../lib/format'

const ROW = 68

function useViewTitle(): { title: string; sentLike: boolean } {
  const view = useStore((s) => s.view)
  const folders = useStore((s) => s.folders)
  const accounts = useStore((s) => s.accounts)
  if (view.type === 'search') return { title: `Résultats pour « ${view.query} »`, sentLike: false }
  if (view.type === 'unified') {
    const titles = { inbox: 'Réception', flagged: 'Suivis', sent: 'Envoyés', drafts: 'Brouillons' }
    return { title: titles[view.role], sentLike: view.role === 'sent' || view.role === 'drafts' }
  }
  const folder = folders.find((f) => f.id === view.folderId)
  const account = accounts.find((a) => a.id === folder?.accountId)
  const name = folder?.role ? ROLE_LABEL[folder.role] : (folder?.name ?? '')
  return {
    title: accounts.length > 1 && account ? `${name} · ${account.name}` : name,
    sentLike: folder?.role === 'sent' || folder?.role === 'drafts'
  }
}

function Row({ t, selected, sentLike, accountColor }: { t: ThreadSummary; selected: boolean; sentLike: boolean; accountColor?: string }) {
  const { select, act } = useStore.getState()
  const who = sentLike
    ? `À : ${t.to.map((a) => displayName(a)).join(', ') || '—'}`
    : t.participants.length > 1
      ? t.participants.slice(-3).join(', ')
      : displayName(t.from)

  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={() => select(threadKey(t))}
      className={`group relative flex h-full cursor-default flex-col justify-center gap-0.5 border-b border-line/60 py-2 pl-5 pr-3 ${
        selected ? 'bg-hover' : 'hover:bg-hover/50'
      }`}
    >
      {accountColor && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: accountColor }} />}
      {t.unread && <span className="absolute left-[9px] top-[17px] size-1.5 rounded-full bg-accent" />}
      <div className="flex items-center gap-2">
        <span className={`min-w-0 truncate text-[13px] ${t.unread ? 'font-semibold text-fg' : 'text-fg-2'}`}>{who}</span>
        {t.count > 1 && <span className="tnum shrink-0 text-[11px] text-muted">{t.count}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted">
          {t.hasAttachments && <Paperclip size={12} />}
          {t.flagged && <Star size={12} className="fill-amber-400 text-amber-400" />}
          <span className="tnum text-[11.5px] group-hover:hidden">{listDate(t.date)}</span>
          <span className="hidden items-center gap-0.5 group-hover:flex">
            {(
              [
                [Archive, 'Archiver (E)', 'archive'],
                [Trash2, 'Supprimer (#)', 'trash'],
                [Star, t.flagged ? 'Ne plus suivre (S)' : 'Suivre (S)', t.flagged ? 'unflag' : 'flag']
              ] as const
            ).map(([Icon, label, action]) => (
              <button
                key={action}
                title={label}
                onClick={(e) => {
                  e.stopPropagation()
                  void act(t, action)
                }}
                className="grid size-6 place-items-center rounded text-muted hover:bg-line hover:text-fg"
              >
                <Icon size={13} strokeWidth={1.75} />
              </button>
            ))}
          </span>
        </span>
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5 text-[12.5px]">
        <span className={`shrink-0 truncate ${t.unread ? 'text-fg' : 'text-fg-2'}`} style={{ maxWidth: '70%' }}>
          {t.subject || '(sans objet)'}
        </span>
        <span className="min-w-0 truncate text-muted">{t.snippet}</span>
      </div>
    </div>
  )
}

function SearchBox() {
  const view = useStore((s) => s.view)
  const [value, setValue] = useState(view.type === 'search' ? view.query : '')
  const previous = useRef(view)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (view.type !== 'search') {
      previous.current = view
      setValue('')
    }
  }, [view])

  const run = (q: string): void => {
    setValue(q)
    clearTimeout(timer.current)
    const { setView, view: now } = useStore.getState()
    // Clearing restores the previous view right away; only typing is debounced.
    if (!q.trim()) {
      if (now.type === 'search') setView(previous.current)
      return
    }
    timer.current = setTimeout(() => setView({ type: 'search', query: q.trim() }), 120)
  }

  return (
    <div className="no-drag relative flex h-7 flex-1 items-center">
      <Search size={13} className="pointer-events-none absolute left-2 text-muted" />
      <input
        id="search-input"
        value={value}
        onChange={(e) => run(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            run('')
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Enter' || e.key === 'ArrowDown') {
            ;(e.target as HTMLInputElement).blur()
            useStore.getState().move(1)
          }
        }}
        placeholder="Rechercher"
        className="h-full w-full rounded-md border border-transparent bg-hover/70 pl-7 pr-7 text-[12.5px] text-fg placeholder:text-muted focus:border-line-strong focus:outline-none"
      />
      {value ? (
        <button onClick={() => run('')} className="absolute right-1.5 text-muted hover:text-fg">
          <X size={13} />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2 text-[11px] text-faint">/</kbd>
      )}
    </div>
  )
}

export function ThreadList() {
  const threads = useStore((s) => s.threads)
  const selected = useStore((s) => s.selected)
  const accounts = useStore((s) => s.accounts)
  const view = useStore((s) => s.view)
  const syncing = useStore((s) => s.syncing)
  const { title, sentLike } = useViewTitle()
  const parent = useRef<HTMLDivElement>(null)
  const colorOf = useMemo(() => new Map(accounts.map((a) => [a.id, a.color])), [accounts])
  const showSpine = accounts.length > 1 && view.type !== 'folder'

  const virtual = useVirtualizer({ count: threads.length, getScrollElement: () => parent.current, estimateSize: () => ROW, overscan: 12 })

  useEffect(() => {
    const idx = threads.findIndex((t) => threadKey(t) === selected)
    if (idx >= 0) virtual.scrollToIndex(idx, { align: 'auto' })
  }, [selected, threads, virtual])

  const items = virtual.getVirtualItems()
  useEffect(() => {
    const last = items.at(-1)
    if (last && last.index >= threads.length - 10) useStore.getState().loadMore()
  }, [items, threads.length])

  const unread = threads.filter((t) => t.unread).length
  const busy = Object.values(syncing).some(Boolean)

  return (
    <section className="flex w-[400px] shrink-0 flex-col border-r border-line bg-bg">
      <header className="drag flex h-10 shrink-0 items-center gap-2 px-3">
        <SearchBox />
      </header>
      <div className="flex h-9 shrink-0 items-baseline gap-2 px-5">
        <h1 className="truncate text-[15px] font-semibold tracking-[-0.015em]">{title}</h1>
        {unread > 0 && <span className="tnum text-[12px] text-muted">{unread} non lus</span>}
      </div>
      <div ref={parent} role="listbox" className="min-h-0 flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="px-6 pt-16 text-center text-[13px] text-muted">
            {busy ? 'Synchronisation en cours…' : view.type === 'search' ? 'Aucun message ne correspond.' : 'Rien ici. Profitez-en.'}
          </div>
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
              const t = threads[item.index]
              return (
                <div key={item.key} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW, transform: `translateY(${item.start}px)` }}>
                  <Row t={t} selected={threadKey(t) === selected} sentLike={sentLike} accountColor={showSpine ? colorOf.get(t.accountId) : undefined} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
