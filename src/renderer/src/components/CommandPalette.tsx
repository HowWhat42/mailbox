import { Command } from 'cmdk'
import { Archive, CalendarDays, File, Folder, Inbox, Moon, PenSquare, Plus, RefreshCw, Reply, Search, Send, Settings, Star, Trash2, type LucideIcon } from 'lucide-react'
import { api, threadKey, useStore } from '../store'
import { ROLE_LABEL } from '../lib/format'
import { replyDraft } from '../lib/reply'

function Item({ icon: Icon, label, hint, onSelect }: { icon: LucideIcon; label: string; hint?: string; onSelect: () => void }) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex h-9 cursor-default items-center gap-3 rounded-md px-3 text-[13px] text-fg-2 data-[selected=true]:bg-hover data-[selected=true]:text-fg"
    >
      <Icon size={15} strokeWidth={1.75} className="text-muted" />
      <span className="flex-1 truncate">{label}</span>
      {hint && <kbd className="text-[11px] text-muted">{hint}</kbd>}
    </Command.Item>
  )
}

const groupCls = 'px-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:text-muted'

export function CommandPalette() {
  const { folders, accounts, theme, threads, selected } = useStore()
  const s = useStore.getState()
  const current = threads.find((t) => threadKey(t) === selected)
  const run = (fn: () => void) => () => {
    s.setPalette(false)
    fn()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 pt-[14vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && s.setPalette(false)}>
      <Command
        label="Commandes"
        loop
        className="pop-in mx-auto w-full max-w-[580px] overflow-hidden rounded-xl bg-raised shadow-pop"
        onKeyDown={(e) => e.key === 'Escape' && s.setPalette(false)}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={15} className="text-muted" />
          <Command.Input autoFocus placeholder="Tapez une commande ou un dossier…" className="h-12 flex-1 bg-transparent text-[14px] text-fg placeholder:text-muted focus:outline-none" />
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto py-1.5">
          <Command.Empty className="px-4 py-6 text-center text-[13px] text-muted">Aucune commande.</Command.Empty>

          {current && (
            <Command.Group heading="Conversation sélectionnée" className={groupCls}>
              <Item icon={Reply} label="Répondre" hint="R" onSelect={run(() => void replyDraft(current, 'reply').then((d) => s.compose(d)))} />
              <Item icon={Archive} label="Archiver" hint="E" onSelect={run(() => void s.act(current, 'archive'))} />
              <Item icon={Trash2} label="Supprimer" hint="#" onSelect={run(() => void s.act(current, 'trash'))} />
              <Item icon={Star} label={current.flagged ? 'Ne plus suivre' : 'Suivre'} hint="S" onSelect={run(() => void s.act(current, current.flagged ? 'unflag' : 'flag'))} />
            </Command.Group>
          )}

          <Command.Group heading="Actions" className={groupCls}>
            <Item icon={PenSquare} label="Nouveau message" hint="C" onSelect={run(() => s.compose())} />
            <Item icon={RefreshCw} label="Synchroniser maintenant" onSelect={run(() => void api.mail.sync().catch((e: Error) => s.toast(e.message, 'error')))} />
            <Item icon={Moon} label={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'} onSelect={run(() => s.setTheme(theme === 'dark' ? 'light' : 'dark'))} />
            <Item icon={Plus} label="Ajouter un compte" onSelect={run(() => s.setSetup(true))} />
            <Item icon={Settings} label="Réglages des comptes" onSelect={run(() => s.setSettings(true))} />
          </Command.Group>

          <Command.Group heading="Aller à" className={groupCls}>
            <Item icon={Inbox} label="Réception" hint="G I" onSelect={run(() => s.setView({ type: 'unified', role: 'inbox' }))} />
            <Item icon={Star} label="Suivis" hint="G S" onSelect={run(() => s.setView({ type: 'unified', role: 'flagged' }))} />
            <Item icon={Send} label="Envoyés" hint="G T" onSelect={run(() => s.setView({ type: 'unified', role: 'sent' }))} />
            <Item icon={File} label="Brouillons" hint="G D" onSelect={run(() => s.setView({ type: 'unified', role: 'drafts' }))} />
            <Item icon={CalendarDays} label="Calendrier" hint="G C" onSelect={run(() => s.setMode('calendar'))} />
            {folders
              .filter((f) => f.role !== 'all' && f.role !== 'flagged')
              .map((f) => {
                const account = accounts.find((a) => a.id === f.accountId)
                const name = f.role ? ROLE_LABEL[f.role] : f.path
                return (
                  <Item
                    key={f.id}
                    icon={Folder}
                    label={accounts.length > 1 ? `${name} — ${account?.name ?? ''}` : name}
                    onSelect={run(() => s.setView({ type: 'folder', folderId: f.id }))}
                  />
                )
              })}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  )
}
