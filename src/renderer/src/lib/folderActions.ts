import { CheckCheck, Trash2 } from 'lucide-react'
import type { Folder, MailScope, MailView } from '@shared/types'
import { api, confirmDialog, useStore } from '../store'
import type { MenuEntry } from '../components/ui/Menu'
import { ROLE_LABEL } from './format'

export async function markAllRead(view: MailView, scope: MailScope = 'all'): Promise<void> {
  const { toast, refreshMail } = useStore.getState()
  try {
    const n = await api.mail.markAllRead(view, scope)
    toast(n ? `${n} message${n > 1 ? 's' : ''} marqué${n > 1 ? 's' : ''} comme lu${n > 1 ? 's' : ''}` : 'Tout était déjà lu')
    void refreshMail()
  } catch (err) {
    toast((err as Error).message, 'error')
  }
}

export async function emptyFolder(folder: Folder): Promise<void> {
  const { toast } = useStore.getState()
  const label = folder.role === 'junk' ? 'les indésirables' : 'la corbeille'
  const ok = await confirmDialog({
    title: `Vider ${label} ?`,
    body: 'Tous ses messages seront supprimés définitivement, sur le serveur aussi. Impossible d’annuler.',
    confirmLabel: 'Vider',
    tone: 'danger'
  })
  if (!ok) return
  try {
    const n = await api.mail.emptyFolder(folder.id)
    toast(`${ROLE_LABEL[folder.role!]} vidé${folder.role === 'junk' ? 's' : 'e'} · ${n} message${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}`)
  } catch (err) {
    toast((err as Error).message, 'error')
  }
}

/** Menu for a folder or box: mark all read, and empty for Trash / Junk. */
export function folderMenu(view: MailView, folder?: Folder, scope: MailScope = 'all'): MenuEntry[] {
  return [
    { label: 'Tout marquer comme lu', icon: CheckCheck, onSelect: () => void markAllRead(view, scope) },
    ...(folder && (folder.role === 'trash' || folder.role === 'junk')
      ? ([
          'separator',
          {
            label: folder.role === 'junk' ? 'Vider les indésirables' : 'Vider la corbeille',
            icon: Trash2,
            danger: true,
            onSelect: () => void emptyFolder(folder)
          }
        ] satisfies MenuEntry[])
      : [])
  ]
}
