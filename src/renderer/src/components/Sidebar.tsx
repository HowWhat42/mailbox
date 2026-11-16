import { useState } from 'react'
import {
  CircleArrowUp,
  Archive,
  CalendarDays,
  ChevronRight,
  File,
  Inbox,
  Moon,
  OctagonAlert,
  PenSquare,
  Plus,
  RefreshCw,
  Send,
  Settings as SettingsIcon,
  Star,
  Sun,
  Tag,
  Trash2,
  WifiOff,
  type LucideIcon
} from 'lucide-react'
import type { Account, Folder, FolderRole, MailView } from '@shared/types'
import { api, useStore } from '../store'
import { avatarColor, ROLE_LABEL } from '../lib/format'
import { SIDEBAR_RANGE, useLayout } from '../lib/layout'
import { ResizeHandle } from './ui/ResizeHandle'
import { NextUp } from './NextUp'
import { Menu, type MenuEntry } from './ui/Menu'
import { folderMenu } from '../lib/folderActions'
import { accountLabel } from '../lib/accounts'

const ROLE_ICON: Partial<Record<Exclude<FolderRole, null>, LucideIcon>> = {
  inbox: Inbox,
  sent: Send,
  drafts: File,
  trash: Trash2,
  junk: OctagonAlert,
  archive: Archive,
  flagged: Star
}
const ROLE_ORDER: FolderRole[] = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash']

function sameView(a: MailView, b: MailView): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function Item({
  icon: Icon,
  label,
  count,
  active,
  onClick,
  color,
  emphasize,
  collapsed,
  onMenu
}: {
  icon: LucideIcon
  label: string
  count?: number
  active?: boolean
  onClick: () => void
  color?: string
  emphasize?: boolean
  collapsed?: boolean
  /** Right-click menu for this entry (folder actions). */
  onMenu?: (anchor: { x: number; y: number }) => void
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={
        onMenu &&
        ((e) => {
          e.preventDefault()
          onMenu({ x: e.clientX, y: e.clientY })
        })
      }
      title={collapsed ? (count ? `${label} (${count})` : label) : undefined}
      aria-label={label}
      className={`group relative flex h-8 w-full items-center gap-2.5 rounded-lg text-left text-[13px] transition-colors ${collapsed ? 'justify-center' : 'px-2.5'} ${
        active ? 'lit text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg'
      }`}
    >
      <Icon
        size={16}
        strokeWidth={1.75}
        className={color ? '' : active ? 'text-fg' : 'text-muted group-hover:text-fg-2'}
        style={color ? { color, fill: color } : undefined}
      />
      {!collapsed && <span className={`min-w-0 flex-1 truncate ${emphasize ? 'font-semibold text-fg' : ''}`}>{label}</span>}
      {!collapsed && !!count && <span className={`tnum text-[12px] ${emphasize ? 'text-fg-2' : 'text-muted'}`}>{count}</span>}
      {collapsed && !!count && emphasize && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" />}
    </button>
  )
}

/** Account in the sidebar: its label or name, and the address underneath to tell same-name accounts apart. */
function AccountName({ account, strong }: { account: Account; strong?: boolean }) {
  const name = account.label.trim() || account.name || account.email
  return (
    <span className="min-w-0 flex-1 leading-tight">
      <span className={`block truncate ${strong ? 'font-semibold text-fg' : ''}`}>{name}</span>
      {name !== account.email && <span className="block truncate text-[11px] text-muted">{account.email}</span>}
    </span>
  )
}

export function Sidebar({ forceExpanded = false }: { forceExpanded?: boolean }) {
  const { mode, view, accounts, folders, counts, syncing, theme } = useStore()
  const layout = useLayout()
  const collapsed = !forceExpanded && layout.rail
  const { compose, setSetup, openSettings, updateSettings, toast } = useStore.getState()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isSyncing = Object.values(syncing).some(Boolean)
  const [menu, setMenu] = useState<{ anchor: { x: number; y: number }; items: MenuEntry[] } | null>(null)
  const menuFor = (target: MailView, folder?: Folder) => (anchor: { x: number; y: number }) => setMenu({ anchor, items: folderMenu(target, folder) })
  const anyOffline = Object.values(useStore((st) => st.offline)).some(Boolean)
  const queue = useStore((st) => st.queue)
  const update = useStore((st) => st.update)
  const errored = accounts.filter((a) => a.syncError)

  const active = (v: MailView): boolean => mode === 'mail' && sameView(view, v)
  // In the drawer, any navigation closes it.
  const setView = (v: MailView): void => {
    useStore.getState().setView(v)
    useStore.getState().setDrawer(false)
  }
  const setMode = (m: 'mail' | 'calendar'): void => {
    useStore.getState().setMode(m)
    useStore.getState().setDrawer(false)
  }

  const sync = async (): Promise<void> => {
    try {
      await api.mail.sync()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const systemFolders = (accountId: string): Folder[] => {
    const own = folders.filter((f) => f.accountId === accountId)
    return ROLE_ORDER.flatMap((r) => own.filter((f) => f.role === r))
  }
  const customFolders = folders.filter((f) => !f.role)

  return (
    <aside
      className={`relative flex shrink-0 flex-col transition-[width] duration-150 ${forceExpanded ? 'h-full w-full' : collapsed ? 'w-[60px]' : ''}`}
      style={forceExpanded || collapsed ? undefined : { width: layout.sidebarWidth }}
    >
      {!forceExpanded && !collapsed && (
        <ResizeHandle
          label="Largeur de la barre latérale"
          min={SIDEBAR_RANGE.min}
          max={SIDEBAR_RANGE.max}
          onChange={(w) => useStore.getState().setSidebarWidth(w)}
          onReset={() => useStore.getState().setSidebarWidth(null)}
        />
      )}
      <div className={collapsed ? 'px-2.5 pb-3' : 'px-3 pb-3'}>
        <button
          onClick={() => {
            compose()
            useStore.getState().setDrawer(false)
          }}
          title={collapsed ? 'Nouveau message (C)' : undefined}
          aria-label="Nouveau message"
          className={`flex h-9 w-full items-center gap-2 rounded-lg btn-primary text-[13px] font-medium ${collapsed ? 'justify-center' : 'px-3'}`}
        >
          <PenSquare size={15} strokeWidth={2} />
          {!collapsed && (
            <>
              Nouveau message
              <kbd className="ml-auto text-[11px] opacity-60">C</kbd>
            </>
          )}
        </button>
      </div>

      <nav className={`min-h-0 flex-1 space-y-5 overflow-y-auto pb-3 ${collapsed ? 'px-2.5' : 'px-3'}`}>
        <div className="space-y-0.5">
          <Item
            collapsed={collapsed}
            icon={Inbox}
            label={accounts.length > 1 ? 'Toutes les boîtes' : 'Réception'}
            count={counts.inbox}
            emphasize={counts.inbox > 0}
            active={active({ type: 'unified', role: 'inbox' })}
            onClick={() => setView({ type: 'unified', role: 'inbox' })}
            onMenu={menuFor({ type: 'unified', role: 'inbox' })}
          />
          {!collapsed && accounts.length > 1 && (
            // One inbox per account, right under the unified one.
            <div className="ml-4 space-y-0.5 border-l border-line pl-2">
              {accounts.map((a) => {
                const inbox = folders.find((f) => f.accountId === a.id && f.role === 'inbox')
                if (!inbox) return null
                const isActive = active({ type: 'folder', folderId: inbox.id })
                return (
                  <button
                    key={a.id}
                    onClick={() => setView({ type: 'folder', folderId: inbox.id })}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      menuFor({ type: 'folder', folderId: inbox.id }, inbox)({ x: e.clientX, y: e.clientY })
                    }}
                    title={a.email}
                    aria-label={`Réception ${accountLabel(a)} (${a.email})`}
                    className={`relative flex min-h-8 w-full items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-1 text-left text-[13px] ${isActive ? 'lit text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg'}`}
                  >
                    <span className="grid size-4 place-items-center">
                      <span className="size-2.5 rounded-full" style={{ background: a.color, boxShadow: `0 0 6px ${a.color}` }} />
                    </span>
                    <AccountName account={a} strong={inbox.unread > 0} />
                    {!!inbox.unread && <span className="tnum text-[12px] text-fg-2">{inbox.unread}</span>}
                  </button>
                )
              })}
            </div>
          )}
          <Item
            collapsed={collapsed}
            icon={Star}
            label="Suivis"
            count={counts.flagged}
            active={active({ type: 'unified', role: 'flagged' })}
            onClick={() => setView({ type: 'unified', role: 'flagged' })}
          />
          <Item
            collapsed={collapsed}
            icon={Send}
            label="Envoyés"
            active={active({ type: 'unified', role: 'sent' })}
            onClick={() => setView({ type: 'unified', role: 'sent' })}
          />
          <Item
            collapsed={collapsed}
            icon={File}
            label="Brouillons"
            active={active({ type: 'unified', role: 'drafts' })}
            onClick={() => setView({ type: 'unified', role: 'drafts' })}
          />
          <Item collapsed={collapsed} icon={CalendarDays} label="Calendrier" active={mode === 'calendar'} onClick={() => setMode('calendar')} />
        </div>

        {!collapsed && accounts.length === 1 && customFolders.length > 0 && (
          <div>
            <div className="mb-1 px-2.5 text-[12px] font-medium text-muted">Dossiers</div>
            <div className="space-y-0.5">
              {customFolders.map((f) => {
                return (
                  <Item
                    key={f.id}
                    icon={Tag}
                    color={avatarColor(f.path)}
                    label={f.name}
                    count={f.unread}
                    emphasize={f.unread > 0}
                    active={active({ type: 'folder', folderId: f.id })}
                    onClick={() => setView({ type: 'folder', folderId: f.id })}
                    onMenu={menuFor({ type: 'folder', folderId: f.id }, f)}
                  />
                )
              })}
            </div>
          </div>
        )}

        {!collapsed && (
          <div>
            <div className="mb-1 px-2.5 text-[12px] font-medium text-muted">Comptes</div>
            {accounts.map((account) => {
              const expanded = open[account.id] ?? false
              return (
                <div key={account.id}>
                  <button
                    onClick={() => setOpen({ ...open, [account.id]: !expanded })}
                    title={account.email}
                    aria-expanded={expanded}
                    className="group flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left text-[13px] text-fg-2 hover:bg-hover hover:text-fg"
                  >
                    <span className="grid size-4 place-items-center">
                      <span className="size-2.5 rounded-[3px]" style={{ background: account.color }} />
                    </span>
                    <AccountName account={account} />
                    {account.syncError && <OctagonAlert size={13} className="text-danger" />}
                    <ChevronRight size={14} className={`text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
                  </button>
                  {expanded && (
                    <div className="ml-4 space-y-0.5 border-l border-line pl-2">
                      {systemFolders(account.id).map((f) => (
                        <Item
                          key={f.id}
                          icon={(f.role && ROLE_ICON[f.role]) || Inbox}
                          label={f.role ? ROLE_LABEL[f.role] : f.name}
                          count={f.role === 'inbox' ? f.unread : undefined}
                          emphasize={f.role === 'inbox' && f.unread > 0}
                          active={active({ type: 'folder', folderId: f.id })}
                          onClick={() => setView({ type: 'folder', folderId: f.id })}
                          onMenu={menuFor({ type: 'folder', folderId: f.id }, f)}
                        />
                      ))}
                      {accounts.length > 1 &&
                        customFolders
                          .filter((f) => f.accountId === account.id)
                          .map((f) => (
                            <Item
                              key={f.id}
                              icon={Tag}
                              color={avatarColor(f.path)}
                              label={f.name}
                              count={f.unread}
                              emphasize={f.unread > 0}
                              active={active({ type: 'folder', folderId: f.id })}
                              onClick={() => setView({ type: 'folder', folderId: f.id })}
                              onMenu={menuFor({ type: 'folder', folderId: f.id }, f)}
                            />
                          ))}
                    </div>
                  )}
                </div>
              )
            })}
            <Item icon={Plus} label="Ajouter un compte" onClick={() => setSetup(true)} />
          </div>
        )}
      </nav>

      {!collapsed && <NextUp />}

      {!collapsed && (anyOffline || queue.outbox > 0 || queue.actions > 0) && (
        // Offline / pending work, Superhuman-style: the app keeps working, this says what's waiting.
        <div className="mx-3 mb-2 space-y-1 rounded-xl border border-line bg-white/[0.02] p-2.5 text-[12px]">
          {anyOffline && (
            <p className="flex items-center gap-2 font-medium text-fg-2">
              <WifiOff size={13} className="text-amber-400" /> Hors ligne
            </p>
          )}
          {queue.actions > 0 && (
            <p className="text-muted">
              {queue.actions} action{queue.actions > 1 ? 's' : ''} en attente de synchronisation
            </p>
          )}
          {queue.outbox > 0 && (
            <button onClick={() => useStore.getState().setOutbox(true)} className="flex w-full items-center gap-2 text-left text-fg-2 hover:text-fg">
              <Send size={12} /> Boîte d’envoi · {queue.outbox}
            </button>
          )}
        </div>
      )}

      {update?.state === 'ready' &&
        (collapsed ? (
          <button
            onClick={() => void api.updates.install()}
            title={`Redémarrer pour installer Mailbox ${update.available}`}
            aria-label="Redémarrer pour mettre à jour"
            className="btn-primary mx-auto mb-2 grid size-8 place-items-center rounded-lg"
          >
            <CircleArrowUp size={15} />
          </button>
        ) : (
          <div role="status" className="mx-3 mb-2 rounded-lg border border-line bg-accent-soft/50 p-2.5">
            <p className="flex items-center gap-2 text-[12.5px] font-medium">
              <CircleArrowUp size={14} className="shrink-0 text-accent" />
              <span className="truncate">Mise à jour prête</span>
              <span className="ml-auto shrink-0 text-[11.5px] font-normal text-muted">{update.available}</span>
            </p>
            <button onClick={() => void api.updates.install()} className="btn-primary mt-2 h-7 w-full rounded-md text-[12px] font-medium">
              Redémarrer pour installer
            </button>
          </div>
        ))}

      {!collapsed && errored.length > 0 && (
        <button
          onClick={() => openSettings()}
          className="mx-3 mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-left text-[12px] leading-snug text-danger"
        >
          {errored.length === 1 ? `${errored[0].email} : ${errored[0].syncError}` : `${errored.length} comptes en erreur`}
        </button>
      )}

      <div className={`flex shrink-0 items-center gap-1 pb-2 ${collapsed ? 'flex-col px-2.5' : 'h-11 px-3'}`}>
        <button
          onClick={() => openSettings()}
          title="Réglages"
          aria-label="Réglages"
          className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <SettingsIcon size={15} strokeWidth={1.75} />
        </button>
        <button
          onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
          title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          aria-label={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          {theme === 'dark' ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
        </button>
        <button
          onClick={sync}
          title="Synchroniser"
          aria-label="Synchroniser"
          className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <RefreshCw size={14} strokeWidth={1.75} className={isSyncing ? 'animate-spin' : ''} />
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={() => useStore.getState().setPalette(true)}
            title="Palette de commandes"
            className="ml-auto rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-fg"
          >
            <kbd>Ctrl K</kbd>
          </button>
        )}
      </div>
      {menu && <Menu anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} minWidth={220} />}
    </aside>
  )
}
