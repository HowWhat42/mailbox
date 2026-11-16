import { useState } from 'react'
import type { Folder, MessageAction, ThreadSummary } from '@shared/types'
import { threadKey, useStore } from '../store'

/** Conversations dragged from the list onto a sidebar folder. */
const THREAD_DRAG = 'application/x-mailbox-threads'

// dataTransfer can't be read during dragover: the dragged conversations are kept here meanwhile.
let dragged: ThreadSummary[] = []

/** Starts dragging a row: all checked conversations if it is one of them, else just this one. */
export function startThreadDrag(e: React.DragEvent, t: ThreadSummary): void {
  const s = useStore.getState()
  const key = threadKey(t)
  dragged = s.checked.has(key) ? s.threads.filter((x) => s.checked.has(threadKey(x))) : [t]
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(THREAD_DRAG, dragged.map(threadKey).join('\n'))
  // A compact label follows the pointer instead of a ghost of the whole row.
  const ghost = document.createElement('div')
  ghost.textContent = dragged.length === 1 ? dragged[0].subject || '(sans objet)' : `${dragged.length} conversations`
  ghost.className = 'drag-ghost'
  document.body.append(ghost)
  e.dataTransfer.setDragImage(ghost, 14, 14)
  setTimeout(() => ghost.remove())
}

export function endThreadDrag(): void {
  dragged = []
}

/** Same account only (IMAP moves stay within one server), and not where they already all are. */
function canDropOn(folder: Folder): boolean {
  return dragged.length > 0 && dragged.every((t) => t.accountId === folder.accountId) && dragged.some((t) => t.folderId !== folder.id)
}

const ACTION_BY_ROLE: Partial<Record<NonNullable<Folder['role']>, MessageAction>> = { trash: 'trash', junk: 'junk', archive: 'archive' }

function dropOn(folder: Folder): void {
  const list = dragged.filter((t) => t.folderId !== folder.id)
  dragged = []
  if (!list.length) return
  const action = (folder.role && ACTION_BY_ROLE[folder.role]) || 'move'
  void useStore.getState().act(list, action, action === 'move' ? folder.id : undefined)
}

/** Drop-target props for a sidebar entry, and whether a drag is hovering it. */
export function useFolderDrop(folder: Folder | undefined): {
  over: boolean
  props: Pick<React.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>
} {
  const [over, setOver] = useState(false)
  if (!folder) return { over: false, props: {} }
  return {
    over,
    props: {
      onDragOver: (e) => {
        if (!e.dataTransfer.types.includes(THREAD_DRAG) || !canDropOn(folder)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      },
      onDrop: (e) => {
        e.preventDefault()
        setOver(false)
        dropOn(folder)
      }
    }
  }
}
