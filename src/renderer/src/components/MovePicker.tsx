import { Command } from 'cmdk'
import { Archive, File, FolderInput, Inbox, OctagonAlert, Send, Tag, Trash2, type LucideIcon } from 'lucide-react'
import type { FolderRole } from '@shared/types'
import { useStore } from '../store'
import { avatarColor, ROLE_LABEL } from '../lib/format'

const ROLE_ICON: Partial<Record<Exclude<FolderRole, null>, LucideIcon>> = {
  inbox: Inbox,
  sent: Send,
  drafts: File,
  trash: Trash2,
  junk: OctagonAlert,
  archive: Archive
}

/** Folder picker for "Déplacer vers…": type to filter, Enter to move. */
export function MovePicker() {
  const threads = useStore((s) => s.movePicker)
  const folders = useStore((s) => s.folders)
  if (!threads) return null
  const { openMovePicker, act } = useStore.getState()
  const accountId = threads[0].accountId
  const here = new Set(threads.map((t) => t.folderId))
  const choices = folders.filter((f) => f.accountId === accountId && !here.has(f.id) && f.role !== 'all' && f.role !== 'flagged')
  const close = (): void => openMovePicker(null)

  return (
    <div role="presentation" className="fixed inset-0 z-50 bg-black/40 pt-[16vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <Command label="Déplacer vers" loop className="pop-in mx-auto w-full max-w-[440px] overflow-hidden rounded-xl glass" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <FolderInput size={15} className="text-muted" />
          <Command.Input
            autoFocus
            placeholder={threads.length > 1 ? `Déplacer ${threads.length} conversations vers…` : 'Déplacer vers…'}
            className="h-12 flex-1 bg-transparent text-[14px] text-fg placeholder:text-muted focus:outline-none"
          />
        </div>
        <Command.List className="max-h-[46vh] overflow-y-auto p-1.5">
          <Command.Empty className="px-4 py-6 text-center text-[13px] text-muted">Aucun dossier ne correspond.</Command.Empty>
          {choices.map((f) => {
            const Icon = (f.role && ROLE_ICON[f.role]) || Tag
            const label = f.role ? ROLE_LABEL[f.role] : f.path
            return (
              <Command.Item
                key={f.id}
                value={label}
                onSelect={() => {
                  close()
                  void act(threads, 'move', f.id)
                }}
                className="flex h-9 cursor-default items-center gap-3 rounded-md px-3 text-[13px] text-fg-2 data-[selected=true]:bg-hover data-[selected=true]:text-fg"
              >
                <Icon size={15} strokeWidth={1.75} className={f.role ? 'text-muted' : ''} style={f.role ? undefined : { color: avatarColor(f.path), fill: avatarColor(f.path) }} />
                {label}
              </Command.Item>
            )
          })}
        </Command.List>
      </Command>
    </div>
  )
}
