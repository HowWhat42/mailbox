import { Archive, FolderInput, Forward, Mail, MailOpen, OctagonAlert, Reply, ReplyAll, Star, StarOff, Trash2 } from 'lucide-react'
import { MAIL_CATEGORIES, type ThreadSummary } from '@shared/types'
import { api, useStore } from '../store'
import { CATEGORY_ICON, CATEGORY_LABEL } from './categories'
import type { MenuEntry } from '../components/ui/Menu'
import { replyDraft, type ReplyKind } from './reply'

export function startReply(thread: ThreadSummary, kind: ReplyKind): void {
  void replyDraft(thread, kind)
    .then((d) => useStore.getState().compose(d))
    .catch((err: Error) => useStore.getState().toast(err.message, 'error'))
}

/** Menu entries for one or several threads (context menu, "more" button). */
export function threadMenu(threads: ThreadSummary[]): MenuEntry[] {
  const s = useStore.getState()
  const single = threads.length === 1 ? threads[0] : null
  const anyUnread = threads.some((t) => t.unread)
  const anyFlagged = threads.some((t) => t.flagged)
  const sameAccount = new Set(threads.map((t) => t.accountId)).size === 1
  return [
    ...(single
      ? ([
          { label: 'Répondre', icon: Reply, hint: 'R', onSelect: () => startReply(single, 'reply') },
          { label: 'Répondre à tous', icon: ReplyAll, hint: 'A', onSelect: () => startReply(single, 'replyAll') },
          { label: 'Transférer', icon: Forward, hint: 'F', onSelect: () => startReply(single, 'forward') },
          'separator'
        ] satisfies MenuEntry[])
      : []),
    anyUnread
      ? { label: 'Marquer comme lu', icon: MailOpen, hint: 'U', onSelect: () => void s.act(threads, 'read') }
      : { label: 'Marquer comme non lu', icon: Mail, hint: 'U', onSelect: () => void s.act(threads, 'unread') },
    anyFlagged
      ? { label: 'Ne plus suivre', icon: StarOff, hint: 'S', onSelect: () => void s.act(threads, 'unflag') }
      : { label: 'Suivre', icon: Star, hint: 'S', onSelect: () => void s.act(threads, 'flag') },
    'separator',
    { label: 'Archiver', icon: Archive, hint: 'E', onSelect: () => void s.act(threads, 'archive') },
    { label: 'Déplacer vers…', icon: FolderInput, hint: 'V', disabled: !sameAccount, onSelect: () => s.openMovePicker(threads) },
    { label: 'Indésirable', icon: OctagonAlert, hint: '!', onSelect: () => void s.act(threads, 'junk') },
    { label: 'Supprimer', icon: Trash2, hint: '#', danger: true, onSelect: () => void s.act(threads, 'trash') },
    // Spark-style: teach the triage where this sender belongs.
    ...(single && single.from.address && single.folderRole !== 'sent' && single.folderRole !== 'drafts'
      ? ([
          'separator',
          ...MAIL_CATEGORIES.filter((c) => c !== single.category).map((c) => ({
            label: `Toujours classer dans ${CATEGORY_LABEL[c]}`,
            icon: CATEGORY_ICON[c],
            onSelect: () =>
              void api.rules.classifySender(single.from.address, c).then(() => {
                s.toast(`Les messages de ${single.from.address} iront dans ${CATEGORY_LABEL[c]}`)
                void s.refreshMail()
              })
          }))
        ] satisfies MenuEntry[])
      : [])
  ]
}
