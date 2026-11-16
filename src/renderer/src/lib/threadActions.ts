import { Archive, FolderInput, Forward, Mail, MailOpen, OctagonAlert, Reply, ReplyAll, Star, StarOff, Trash2 } from 'lucide-react'
import type { ThreadSummary } from '@shared/types'
import { useStore } from '../store'
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
    { label: 'Supprimer', icon: Trash2, hint: '#', danger: true, onSelect: () => void s.act(threads, 'trash') }
  ]
}
