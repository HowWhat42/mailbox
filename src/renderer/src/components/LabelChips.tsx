import { useStore } from '../store'
import { avatarColor } from '../lib/format'

/**
 * Gmail labels / IMAP keywords as small chips. A label that is also a folder of the account (Gmail)
 * takes that folder's colour from the sidebar and opens it on click.
 */
export function LabelChips({ labels, accountId, max = 3, size = 'sm' }: { labels: string[]; accountId: string; max?: number; size?: 'sm' | 'md' }) {
  const folders = useStore((s) => s.folders)
  if (!labels.length) return null
  const shown = labels.slice(0, max)
  return (
    <span className="flex min-w-0 shrink items-center gap-1">
      {shown.map((label) => {
        const folder = folders.find((f) => f.accountId === accountId && f.path === label)
        const color = avatarColor(folder?.path ?? label)
        const name = label.split('/').at(-1) ?? label
        const cls = `inline-flex max-w-[140px] shrink-0 items-center truncate rounded-md px-1.5 font-medium ${size === 'md' ? 'h-6 text-[12px]' : 'h-[18px] text-[11px]'}`
        const style = { background: `color-mix(in oklch, ${color} 18%, transparent)`, color: `color-mix(in oklch, ${color} 75%, var(--fg))` }
        return folder ? (
          <button
            key={label}
            type="button"
            title={`Ouvrir ${label}`}
            onClick={(e) => {
              e.stopPropagation()
              useStore.getState().setView({ type: 'folder', folderId: folder.id })
            }}
            className={`${cls} hover:brightness-125`}
            style={style}
          >
            {name}
          </button>
        ) : (
          <span key={label} title={label} className={cls} style={style}>
            {name}
          </span>
        )
      })}
      {labels.length > max && <span className="tnum shrink-0 text-[11px] text-muted">+{labels.length - max}</span>}
    </span>
  )
}
