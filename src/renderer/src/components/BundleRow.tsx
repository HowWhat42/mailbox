import { Archive, CheckCheck } from 'lucide-react'
import type { Bundle, MailCategory } from '@shared/types'
import { api, confirmDialog, useStore } from '../store'
import { CATEGORY_ICON, CATEGORY_LABEL } from '../lib/categories'
import { listDate } from '../lib/format'
import { Avatar } from './Avatar'

export const CATEGORY_TINT: Record<MailCategory, string> = {
  people: '#8f86f0',
  notifications: '#4ade80',
  newsletters: '#f5a524',
  invitations: '#f472b6'
}

/** Spark-style bundle: a whole category in one row, summarised by sender. Click to open it. */
export function BundleRow({ bundle, compact }: { bundle: Bundle; compact: boolean }) {
  const { setCategory, view, toast, refreshMail } = useStore.getState()
  const Icon = CATEGORY_ICON[bundle.category]
  const tint = CATEGORY_TINT[bundle.category]
  const label = CATEGORY_LABEL[bundle.category]

  const bulk = async (action: 'read' | 'archive'): Promise<void> => {
    if (action === 'archive') {
      const ok = await confirmDialog({
        title: `Archiver tout ${label.toLowerCase()} ?`,
        body: `${bundle.threads} conversation${bundle.threads > 1 ? 's' : ''} quitteront la boîte de réception. Elles restent dans les archives.`,
        confirmLabel: 'Tout archiver'
      })
      if (!ok) return
    }
    try {
      const n = await api.mail.bundleAct(view, bundle.category, action)
      toast(action === 'read' ? `${label} : ${n} message${n > 1 ? 's' : ''} marqué${n > 1 ? 's' : ''} comme lu${n > 1 ? 's' : ''}` : `${label} archivées`)
      void refreshMail()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div className="h-full px-2 py-0.5">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label} : ${bundle.threads} conversations, ${bundle.unread} non lues`}
        data-bundle={bundle.category}
        onClick={() => setCategory(bundle.category)}
        onKeyDown={(e) => e.key === 'Enter' && setCategory(bundle.category)}
        className={`group flex h-full cursor-default gap-3 rounded-lg px-3 transition-colors hover:bg-hover ${compact ? 'items-center py-1.5' : 'py-2.5'}`}
      >
        <span
          className={`grid shrink-0 place-items-center rounded-full ${compact ? 'ml-7 size-[26px]' : 'ml-7 mt-0.5 size-8'}`}
          style={{ background: `color-mix(in oklch, ${tint} 18%, transparent)`, color: tint, boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${tint} 30%, transparent)` }}
        >
          <Icon size={compact ? 13 : 15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-[13px] ${bundle.unread ? 'font-semibold text-fg' : 'font-medium text-fg-2'}`}>{label}</span>
            <span className={`tnum text-[11.5px] ${bundle.unread ? 'font-semibold text-accent' : 'text-muted'}`}>{bundle.unread || bundle.threads}</span>
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              <span className="tnum text-[11.5px] text-muted group-hover:hidden">{listDate(bundle.latest)}</span>
              <span className="hidden items-center gap-0.5 group-hover:flex">
                {bundle.unread > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void bulk('read')
                    }}
                    title="Tout marquer comme lu"
                    aria-label={`Tout marquer comme lu dans ${label}`}
                    className="grid size-6 place-items-center rounded text-muted hover:bg-line hover:text-fg"
                  >
                    <CheckCheck size={14} />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void bulk('archive')
                  }}
                  title="Tout archiver"
                  aria-label={`Tout archiver dans ${label}`}
                  className="grid size-6 place-items-center rounded text-muted hover:bg-line hover:text-fg"
                >
                  <Archive size={13} />
                </button>
              </span>
            </span>
          </div>
          <div className={`mt-1 flex min-w-0 gap-x-3 gap-y-1 overflow-hidden ${compact ? 'h-5 flex-nowrap' : 'max-h-[42px] flex-wrap'}`}>
            {bundle.senders.map((s) => (
              <span key={s.address} className={`flex min-w-0 max-w-[48%] shrink-0 items-center gap-1.5 text-[12px] ${s.unread ? 'text-fg' : 'text-muted'}`} title={s.address}>
                <Avatar name={s.name} seed={s.address} size={16} />
                <span className={`truncate ${s.unread ? 'font-medium' : ''}`}>{s.name}</span>
                {s.count > 1 && <span className="tnum shrink-0 text-[11px] text-muted">{s.count}</span>}
              </span>
            ))}
            {bundle.moreSenders > 0 && <span className="tnum shrink-0 text-[11.5px] text-muted">+{bundle.moreSenders}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
