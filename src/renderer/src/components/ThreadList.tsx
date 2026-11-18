import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Archive,
  ArrowLeft,
  FolderInput,
  Mail,
  MailOpen,
  MoreHorizontal,
  OctagonAlert,
  Paperclip,
  PenSquare,
  RefreshCw,
  Star,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import type { Account, AccountMarker, Bundle, MailCategory, MailFilter, ThreadSummary } from '@shared/types'
import { AccountDot, AccountTag, accountLabel, useAccountMarker } from '../lib/accounts'
import { CATEGORY_ICON, CATEGORY_LABEL } from '../lib/categories'
import { BundleRow, CATEGORY_TINT } from './BundleRow'
import { threadKey, useStore } from '../store'
import { dateGroup, displayName, listDate, ROLE_LABEL } from '../lib/format'
import { threadMenu } from '../lib/threadActions'
import { useLayout } from '../lib/layout'
import { Avatar } from './Avatar'
import { Checkbox } from './ui/Controls'
import { Menu, type MenuEntry } from './ui/Menu'
import { folderMenu } from '../lib/folderActions'
import { ResizeHandle } from './ui/ResizeHandle'
import { LIST_RANGE } from '../lib/panes'
import { endThreadDrag, startThreadDrag } from '../lib/dnd'
import { LabelChips } from './LabelChips'
import type { Anchor } from './ui/Popover'

const ROW = { comfortable: 92, compact: 60 }
const HEADER = 34

type Item = { type: 'header'; label: string } | { type: 'thread'; t: ThreadSummary } | { type: 'bundle'; b: Bundle }

function useViewInfo(): { title: string; sentLike: boolean } {
  const view = useStore((s) => s.view)
  const folders = useStore((s) => s.folders)
  const accounts = useStore((s) => s.accounts)
  if (view.type === 'search') return { title: 'Recherche', sentLike: false }
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

function Row({
  t,
  selected,
  checked,
  sentLike,
  account,
  marker,
  onContext,
  compact
}: {
  t: ThreadSummary
  selected: boolean
  checked: boolean
  sentLike: boolean
  account?: Account
  marker: AccountMarker
  onContext: (e: React.MouseEvent) => void
  compact: boolean
}) {
  const { select, toggleCheck } = useStore.getState()
  const key = threadKey(t)
  const isDraft = t.folderRole === 'drafts'
  const person = sentLike ? (t.to[0] ?? t.from) : t.from
  const who = isDraft
    ? `Brouillon${t.to.length ? ` · ${t.to.map((a) => displayName(a)).join(', ')}` : ''}`
    : sentLike
      ? `À ${t.to.map((a) => displayName(a)).join(', ') || '—'}`
      : t.participants.length > 1
        ? t.participants.slice(-3).join(', ')
        : displayName(t.from)

  return (
    <div className="h-full px-2 py-0.5">
      <div
        role="option"
        aria-selected={selected}
        tabIndex={-1}
        onClick={(e) => (e.ctrlKey || e.metaKey ? toggleCheck(key) : select(key))}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && select(key)}
        onContextMenu={onContext}
        draggable
        onDragStart={(e) => startThreadDrag(e, t)}
        onDragEnd={endThreadDrag}
        className={`group relative flex h-full cursor-default gap-3 rounded-lg px-3 transition-colors ${compact ? 'items-center py-1.5' : 'py-2.5'} ${
          selected ? 'lit' : checked ? 'bg-accent-soft' : 'hover:bg-hover'
        }`}
      >
        {account && marker === 'stripe' && (
          <span
            aria-hidden
            className="absolute inset-y-1.5 left-0 w-[3px] rounded-full"
            style={{ background: account.color, boxShadow: `0 0 8px ${account.color}` }}
          />
        )}
        <div className={`flex shrink-0 gap-3 ${compact ? 'items-center' : 'items-start pt-0.5'}`}>
          <span className={`${compact ? '' : 'pt-2'} ${checked ? '' : 'opacity-60 group-hover:opacity-100'}`}>
            <Checkbox checked={checked} onChange={() => toggleCheck(key)} label="Sélectionner" />
          </span>
          <span
            className="relative rounded-full"
            style={account && marker === 'ring' ? { boxShadow: `0 0 0 2px var(--surface-solid), 0 0 0 4px ${account.color}` } : undefined}
            title={account && marker === 'ring' ? `${accountLabel(account)} · ${account.email}` : undefined}
          >
            <Avatar name={displayName(person)} seed={person.address || displayName(person)} size={compact ? 26 : 32} />
            {t.unread && <span className="absolute -left-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-accent" />}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`min-w-0 truncate text-[13px] ${isDraft ? 'text-danger' : t.unread ? 'font-semibold text-fg' : 'font-medium text-fg-2'}`}
            >
              {who}
            </span>
            {t.count > 1 && <span className="tnum shrink-0 rounded bg-hover px-1 text-[10.5px] text-muted">{t.count}</span>}
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted">
              {t.hasAttachments && <Paperclip size={12} />}
              {t.flagged && <Star size={12} className="fill-amber-400 text-amber-400" />}
              {account && marker === 'tag' && <AccountTag account={account} />}
              {account && marker === 'dot' && <AccountDot account={account} />}
              <span className={`tnum text-[11.5px] ${t.unread ? 'text-fg-2' : ''}`}>{listDate(t.date)}</span>
            </span>
          </div>
          {compact ? (
            <div className="flex min-w-0 items-baseline gap-1.5 text-[12.5px]">
              <span className={`shrink-0 truncate ${t.unread ? 'font-semibold text-fg' : 'text-fg-2'}`} style={{ maxWidth: '65%' }}>
                {t.subject || '(sans objet)'}
              </span>
              <LabelChips labels={t.labels} accountId={t.accountId} max={1} />
              <span className="min-w-0 truncate text-muted">{t.snippet}</span>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={`min-w-0 truncate text-[13px] ${t.unread ? 'font-semibold text-fg' : 'text-fg-2'}`}>
                  {t.subject || '(sans objet)'}
                </span>
                <LabelChips labels={t.labels} accountId={t.accountId} max={2} />
              </div>
              <p className="line-clamp-2 text-[12px] leading-[1.45] text-muted">{t.snippet || ' '}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  spin
}: {
  icon: LucideIcon
  label: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  spin?: boolean
}) {
  return (
    <button
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
    >
      <Icon size={15} strokeWidth={1.75} className={spin ? 'animate-spin' : ''} />
    </button>
  )
}

const FILTERS: { value: MailFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'unread', label: 'Non lus' },
  { value: 'flagged', label: 'Suivis' },
  { value: 'attachments', label: 'Pièces jointes' }
]

/** Order of the pinned bundles at the top of the smart inbox. */
const BUNDLE_ORDER: MailCategory[] = ['notifications', 'invitations', 'newsletters']

export function ThreadList() {
  const threads = useStore((s) => s.threads)
  const selected = useStore((s) => s.selected)
  const checked = useStore((s) => s.checked)
  const view = useStore((s) => s.view)
  const filter = useStore((s) => s.filter)
  const syncing = useStore((s) => s.syncing)
  const { title, sentLike } = useViewInfo()
  const settings = useStore((s) => s.settings)
  const category = useStore((s) => s.category)
  const bundles = useStore((s) => s.bundles)
  const compact = settings?.density === 'compact'
  const rowHeight = ROW[compact ? 'compact' : 'comfortable']
  const smart = useStore((s) => s.smartView())
  // Inside a bundle (Notifications, Newsletters…): the list gets a back button.
  const inBundle = smart && category !== 'smart' && category !== 'all' ? (category as MailCategory) : null
  const { single } = useLayout()
  const s = useStore.getState()
  const parent = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ anchor: Anchor; threads: ThreadSummary[] } | null>(null)
  const [viewMenu, setViewMenu] = useState<{ anchor: Anchor; items: MenuEntry[] } | null>(null)
  const folders = useStore((st) => st.folders)
  const listWidth = useStore((st) => st.listWidth)
  // A single account's folder needs no marker; the unified boxes and search do.
  const markers = useAccountMarker(view.type !== 'folder')

  const items = useMemo<Item[]>(() => {
    // Bundles stay pinned on top, in a fixed order, as long as they hold something; conversations follow by date.
    const shown = bundles
      .filter((b) => b.threads > 0 && (filter === 'all' || (filter === 'unread' && b.unread > 0)))
      .toSorted((a, b) => BUNDLE_ORDER.indexOf(a.category) - BUNDLE_ORDER.indexOf(b.category))
    const out: Item[] = shown.map((b) => ({ type: 'bundle', b }))
    let last = ''
    for (const t of threads) {
      const g = dateGroup(t.date)
      if (g !== last) out.push({ type: 'header', label: g })
      last = g
      out.push({ type: 'thread', t })
    }
    return out
  }, [threads, bundles, filter])

  // oxlint-disable-next-line react/incompatible-library -- no React Compiler here; the virtualizer is used as documented.
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: (i) => (items[i].type === 'header' ? HEADER : items[i].type === 'bundle' ? (compact ? 48 : 66) : rowHeight),
    // Measured sizes are cached per key: keyed by position, a header or a short row would inherit the
    // height of whatever sat at its index before the list changed, leaving big gaps.
    getItemKey: (i) => {
      const it = items[i]
      return it.type === 'header' ? `h:${it.label}` : it.type === 'bundle' ? `b:${it.b.category}` : `t:${threadKey(it.t)}`
    },
    overscan: 10
  })

  // Row height changes with the density setting: drop cached sizes.
  useEffect(() => virtual.measure(), [rowHeight, virtual])

  // Bring a newly selected conversation into view (keyboard moves, opening from elsewhere) — once.
  // Re-running on every list update would yank the user back to it while they scroll away.
  const revealed = useRef<string | null>(null)
  useEffect(() => {
    if (!selected || revealed.current === selected) return
    const idx = items.findIndex((it) => it.type === 'thread' && threadKey(it.t) === selected)
    if (idx < 0) return
    revealed.current = selected
    virtual.scrollToIndex(idx, { align: 'auto' })
  }, [selected, items, virtual])

  const vItems = virtual.getVirtualItems()
  useEffect(() => {
    const last = vItems.at(-1)
    if (last && last.index >= items.length - 10) useStore.getState().loadMore()
  }, [vItems, items.length])

  const unread = threads.filter((t) => t.unread).length
  const busy = Object.values(syncing).some(Boolean)
  const targets = s.targets()
  const none = targets.length === 0
  const allChecked = threads.length > 0 && checked.size === threads.length

  const openContext = (e: React.MouseEvent, t: ThreadSummary): void => {
    e.preventDefault()
    const key = threadKey(t)
    let list: ThreadSummary[]
    if (checked.has(key)) list = threads.filter((x) => checked.has(threadKey(x)))
    else {
      s.select(key)
      list = [t]
    }
    setMenu({ anchor: { x: e.clientX, y: e.clientY }, threads: list })
  }

  return (
    <section
      className={`@container relative flex min-w-0 flex-col ${single ? 'flex-1' : `shrink-0 border-r border-line ${listWidth ? '' : 'w-[clamp(320px,30vw,560px)]'}`}`}
      style={!single && listWidth ? { width: listWidth } : undefined}
    >
      {!single && (
        <ResizeHandle
          label="Largeur de la liste des messages"
          min={LIST_RANGE.min}
          max={LIST_RANGE.max}
          onChange={(w) => useStore.getState().setListWidth(w)}
          onReset={() => useStore.getState().setListWidth(null)}
        />
      )}
      <header className="flex shrink-0 items-start gap-2 px-5 pb-3 pt-4">
        {inBundle && (
          <button
            onClick={() => s.setCategory('smart')}
            aria-label="Retour à la réception"
            title="Retour à la réception (Échap)"
            className="-ml-2 mt-0.5 grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
          >
            <ArrowLeft size={17} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-[18px] font-semibold tracking-[-0.02em]">
            {inBundle && (
              <span
                className="grid size-6 place-items-center rounded-full"
                style={{ background: `color-mix(in oklch, ${CATEGORY_TINT[inBundle]} 18%, transparent)`, color: CATEGORY_TINT[inBundle] }}
              >
                {(() => {
                  const I = CATEGORY_ICON[inBundle]
                  return <I size={13} />
                })()}
              </span>
            )}
            {view.type === 'search' ? `« ${view.query} »` : inBundle ? CATEGORY_LABEL[inBundle] : title}
          </h1>
          <p className="tnum mt-0.5 text-[12px] text-muted">
            {busy && threads.length === 0
              ? 'Synchronisation…'
              : unread
                ? `${unread} non lu${unread > 1 ? 's' : ''}`
                : `${threads.length} conversation${threads.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <ToolButton icon={RefreshCw} label="Relever le courrier (F5)" spin={busy} onClick={() => s.syncNow()} />
        <ToolButton
          icon={MoreHorizontal}
          label="Actions sur cette vue"
          onClick={(e) => {
            const folder = view.type === 'folder' ? folders.find((f) => f.id === view.folderId) : undefined
            const scope = smart && category !== 'smart' && category !== 'all' ? (category as MailCategory) : 'all'
            setViewMenu({ anchor: e.currentTarget, items: folderMenu(view, folder, scope) })
          }}
        />
        <ToolButton icon={PenSquare} label="Nouveau message (C)" onClick={() => s.compose()} />
      </header>

      <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-5 pb-3">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => s.setFilter(f.value)}
            className={`h-7 shrink-0 rounded-lg border px-2.5 text-[12px] transition-colors ${
              filter === f.value ? 'border-transparent lit text-fg' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex h-10 shrink-0 items-center gap-0.5 border-y border-line px-4">
        <span className="mr-1.5 grid size-8 place-items-center">
          <Checkbox
            checked={allChecked}
            indeterminate={checked.size > 0 && !allChecked}
            onChange={() => s.setChecked(allChecked || checked.size ? [] : threads.map(threadKey))}
            label="Tout sélectionner"
          />
        </span>
        {checked.size > 0 && <span className="tnum mr-2 text-[12px] text-fg-2">{checked.size}</span>}
        <ToolButton icon={Archive} label="Archiver (E)" disabled={none} onClick={() => void s.act(targets, 'archive')} />
        <span className="hidden @[380px]:contents">
          <ToolButton icon={OctagonAlert} label="Indésirable (!)" disabled={none} onClick={() => void s.act(targets, 'junk')} />
        </span>
        <ToolButton icon={Trash2} label="Supprimer (#)" disabled={none} onClick={() => void s.act(targets, 'trash')} />
        <span className="mx-1 h-4 w-px bg-line" />
        {targets.some((t) => t.unread) ? (
          <ToolButton icon={MailOpen} label="Marquer comme lu (U)" disabled={none} onClick={() => void s.act(targets, 'read')} />
        ) : (
          <ToolButton icon={Mail} label="Marquer comme non lu (U)" disabled={none} onClick={() => void s.act(targets, 'unread')} />
        )}
        <ToolButton
          icon={Star}
          label="Suivre (S)"
          disabled={none}
          onClick={() => void s.act(targets, targets.every((t) => t.flagged) ? 'unflag' : 'flag')}
        />
        <span className="hidden @[380px]:contents">
          <ToolButton
            icon={FolderInput}
            label="Déplacer vers… (V)"
            disabled={none || new Set(targets.map((t) => t.accountId)).size > 1}
            onClick={() => s.openMovePicker(targets)}
          />
        </span>
        <span className="flex-1" />
        <ToolButton
          icon={MoreHorizontal}
          label="Plus d’actions"
          disabled={none}
          onClick={(e) => setMenu({ anchor: e.currentTarget, threads: targets })}
        />
      </div>

      <div ref={parent} role="listbox" aria-label={title} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {items.length === 0 ? (
          <div className="px-8 pt-20 text-center">
            <p className="text-[13.5px] font-medium text-fg-2">
              {busy
                ? 'Synchronisation en cours…'
                : view.type === 'search'
                  ? 'Aucun message ne correspond'
                  : filter !== 'all'
                    ? 'Aucune conversation pour ce filtre'
                    : 'Tout est traité'}
            </p>
            <p className="mt-1 text-[12.5px] text-muted">
              {view.type === 'search'
                ? 'Essayez un autre mot, un nom ou une adresse.'
                : filter !== 'all'
                  ? 'Revenez à « Tous » pour tout afficher.'
                  : 'Les nouveaux messages apparaîtront ici.'}
            </p>
          </div>
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {vItems.map((v) => {
              const it = items[v.index]
              return (
                <div
                  key={v.key}
                  // Rows are measured, not trusted to the estimate: fonts, display scaling, density, labels and
                  // wrapped bundle senders all change their height, and an underestimated row spills over the next.
                  data-index={v.index}
                  ref={it.type === 'header' ? undefined : virtual.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: it.type === 'header' ? v.size : undefined,
                    transform: `translateY(${v.start}px)`
                  }}
                >
                  {it.type === 'header' ? (
                    <div data-list-header className="flex h-full items-end px-5 pb-1.5 text-[12px] font-medium text-muted">
                      {it.label}
                    </div>
                  ) : it.type === 'bundle' ? (
                    <BundleRow bundle={it.b} compact={compact} />
                  ) : (
                    <Row
                      t={it.t}
                      selected={threadKey(it.t) === selected}
                      checked={checked.has(threadKey(it.t))}
                      sentLike={sentLike}
                      account={markers.account(it.t.accountId)}
                      marker={markers.style}
                      onContext={(e) => openContext(e, it.t)}
                      compact={compact}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {menu && <Menu anchor={menu.anchor} items={threadMenu(menu.threads)} onClose={() => setMenu(null)} minWidth={230} />}
      {viewMenu && <Menu anchor={viewMenu.anchor} align="end" items={viewMenu.items} onClose={() => setViewMenu(null)} minWidth={220} />}
    </section>
  )
}
