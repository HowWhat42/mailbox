import { useState } from 'react'
import {
  Archive,
  CalendarDays,
  ChevronRight,
  File,
  Folder as FolderIcon,
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
  Trash2,
  type LucideIcon
} from 'lucide-react'
import type { Folder, FolderRole, MailView } from '@shared/types'
import { api, useStore } from '../store'
import { ROLE_LABEL } from '../lib/format'

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
  dot,
  depth = 0
}: {
  icon: LucideIcon
  label: string
  count?: number
  active?: boolean
  onClick: () => void
  dot?: string
  depth?: number
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex h-7 w-full items-center gap-2.5 rounded-md pr-2 text-left text-[13px] transition-colors ${
        active ? 'bg-hover text-fg' : 'text-fg-2 hover:bg-hover/60 hover:text-fg'
      }`}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <Icon size={15} strokeWidth={1.75} className={active ? 'text-fg' : 'text-muted group-hover:text-fg-2'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} />}
      {!!count && <span className="tnum text-[11.5px] text-muted">{count}</span>}
    </button>
  )
}

export function Sidebar() {
  const { mode, view, accounts, folders, counts, syncing, theme } = useStore()
  const { setView, setMode, compose, setSetup, setSettings, setTheme, toast } = useStore.getState()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isSyncing = Object.values(syncing).some(Boolean)
  const errored = accounts.filter((a) => a.syncError)

  const go = (v: MailView): void => setView(v)
  const active = (v: MailView): boolean => mode === 'mail' && sameView(view, v)

  const sync = async (): Promise<void> => {
    try {
      await api.mail.sync()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const foldersFor = (accountId: string): Folder[] => {
    const own = folders.filter((f) => f.accountId === accountId && f.role !== 'all' && f.role !== 'flagged')
    const special = ROLE_ORDER.flatMap((r) => own.filter((f) => f.role === r))
    const custom = own.filter((f) => !f.role)
    return [...special, ...custom]
  }

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="drag flex h-10 shrink-0 items-center pl-3 pr-2">
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-fg">Mailbox</span>
        <button
          onClick={sync}
          title="Synchroniser"
          className="no-drag ml-auto grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <RefreshCw size={14} strokeWidth={1.75} className={isSyncing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-2 pb-2">
        <button
          onClick={() => compose()}
          className="flex h-8 w-full items-center gap-2 rounded-md bg-accent px-2.5 text-[13px] font-medium text-accent-fg shadow-sm transition-[filter] hover:brightness-110"
        >
          <PenSquare size={15} strokeWidth={2} />
          Nouveau message
          <kbd className="ml-auto text-[11px] opacity-60">C</kbd>
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        <div className="space-y-px">
          <Item
            icon={Inbox}
            label="Réception"
            count={counts.inbox}
            active={active({ type: 'unified', role: 'inbox' })}
            onClick={() => go({ type: 'unified', role: 'inbox' })}
          />
          <Item
            icon={Star}
            label="Suivis"
            count={counts.flagged}
            active={active({ type: 'unified', role: 'flagged' })}
            onClick={() => go({ type: 'unified', role: 'flagged' })}
          />
          <Item icon={Send} label="Envoyés" active={active({ type: 'unified', role: 'sent' })} onClick={() => go({ type: 'unified', role: 'sent' })} />
          <Item
            icon={File}
            label="Brouillons"
            active={active({ type: 'unified', role: 'drafts' })}
            onClick={() => go({ type: 'unified', role: 'drafts' })}
          />
          <Item icon={CalendarDays} label="Calendrier" active={mode === 'calendar'} onClick={() => setMode('calendar')} />
        </div>

        {accounts.map((account) => {
          const expanded = open[account.id] ?? accounts.length === 1
          return (
            <div key={account.id}>
              <button
                onClick={() => setOpen({ ...open, [account.id]: !expanded })}
                className="group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-muted hover:text-fg-2"
              >
                <span className="size-2 shrink-0 rounded-[3px]" style={{ background: account.color }} />
                <span className="min-w-0 flex-1 truncate font-medium">{account.name}</span>
                {account.syncError && <OctagonAlert size={13} className="text-danger" />}
                <ChevronRight size={13} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
              </button>
              {expanded && (
                <div className="space-y-px">
                  {foldersFor(account.id).map((f) => (
                    <Item
                      key={f.id}
                      icon={(f.role && ROLE_ICON[f.role]) || FolderIcon}
                      label={f.role ? ROLE_LABEL[f.role] : f.name}
                      count={f.role === 'inbox' || !f.role ? f.unread : undefined}
                      active={active({ type: 'folder', folderId: f.id })}
                      onClick={() => go({ type: 'folder', folderId: f.id })}
                      depth={f.role ? 0 : Math.max(0, f.path.split(/[/.]/).length - 1)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <Item icon={Plus} label="Ajouter un compte" onClick={() => setSetup(true)} />
      </nav>

      {errored.length > 0 && (
        <button
          onClick={() => setSettings(true)}
          className="mx-2 mb-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-left text-[12px] text-danger"
        >
          {errored.length === 1 ? `${errored[0].email} : ${errored[0].syncError}` : `${errored.length} comptes en erreur`}
        </button>
      )}

      <div className="flex h-10 shrink-0 items-center gap-1 border-t border-line px-2">
        <button
          onClick={() => setSettings(true)}
          className="flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] text-muted hover:bg-hover hover:text-fg"
        >
          <SettingsIcon size={14} strokeWidth={1.75} />
          Réglages
        </button>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          className="ml-auto grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          {theme === 'dark' ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
        </button>
        <kbd
          onClick={() => useStore.getState().setPalette(true)}
          className="cursor-pointer rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-fg"
        >
          Ctrl K
        </kbd>
      </div>
    </aside>
  )
}
