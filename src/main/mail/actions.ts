import type { ImapFlow } from 'imapflow'
import type { FolderRole, MessageAction } from '@shared/types'
import { getDb, tx } from '../db'
import { emit } from '../events'
import { getAccount } from '../accounts/store'
import { inMailbox, withImap } from './imap'
import { describeError, foldersOf, syncAccount, type FolderRow } from './sync'

interface Target {
  id: string
  uid: number
  account_id: string
  folder_id: string
  unread: number
  flagged: number
}

const MOVE_ROLE: Partial<Record<MessageAction, FolderRole>> = { archive: 'archive', trash: 'trash', junk: 'junk' }

/** Applies `action` locally first (instant UI), then on the server; resyncs on failure. */
export async function applyAction(messageIds: string[], action: MessageAction, destFolderId?: string): Promise<void> {
  if (!messageIds.length) return
  if (action === 'move' && !destFolderId) throw new Error('Dossier de destination manquant.')
  const db = getDb()
  const targets = db
    .prepare(`SELECT id, uid, account_id, folder_id, unread, flagged FROM messages WHERE id IN (${messageIds.map(() => '?').join(',')})`)
    .all(...messageIds) as unknown as Target[]

  // Skip no-op flag changes so we don't hit the server for nothing.
  const relevant = targets.filter((t) => {
    if (action === 'read') return t.unread === 1
    if (action === 'unread') return t.unread === 0
    if (action === 'flag') return t.flagged === 0
    if (action === 'unflag') return t.flagged === 1
    return true
  })
  if (!relevant.length) return

  tx(() => {
    for (const t of relevant) {
      if (action === 'read') db.prepare('UPDATE messages SET unread = 0 WHERE id = ?').run(t.id)
      else if (action === 'unread') db.prepare('UPDATE messages SET unread = 1 WHERE id = ?').run(t.id)
      else if (action === 'flag') db.prepare('UPDATE messages SET flagged = 1 WHERE id = ?').run(t.id)
      else if (action === 'unflag') db.prepare('UPDATE messages SET flagged = 0 WHERE id = ?').run(t.id)
      else db.prepare('DELETE FROM messages WHERE id = ?').run(t.id)
      // Keep the sidebar's per-folder unread counter in step until the next sync.
      const moves = !!MOVE_ROLE[action] || action === 'move'
      const delta = action === 'read' ? -1 : action === 'unread' ? 1 : moves && t.unread ? -1 : 0
      if (delta) db.prepare('UPDATE folders SET unread = max(0, unread + ?) WHERE id = ?').run(delta, t.folder_id)
    }
  })
  const accounts = new Set(relevant.map((t) => t.account_id))
  for (const accountId of accounts) emit('mail:changed', { accountId })

  for (const accountId of accounts) {
    const account = getAccount(accountId)
    const folders = foldersOf(accountId)
    try {
      await withImap(account, async (client) => {
        for (const [folderId, msgs] of Map.groupBy(
          relevant.filter((t) => t.account_id === accountId),
          (t) => t.folder_id
        )) {
          const folder = folders.find((f) => f.id === folderId)
          if (!folder) continue
          await inMailbox(client, folder.path, () => serverAction(client, account.kind, folders, folder, msgs, action, destFolderId))
        }
      })
    } catch (err) {
      void syncAccount(accountId).catch(() => {})
      throw new Error(describeError(err))
    }
    if (MOVE_ROLE[action] || action === 'move') void syncAccount(accountId).catch(() => {})
  }
}

async function serverAction(
  client: ImapFlow,
  kind: 'imap' | 'google',
  folders: FolderRow[],
  folder: FolderRow,
  msgs: Target[],
  action: MessageAction,
  destFolderId?: string
): Promise<void> {
  const uids = msgs.map((m) => m.uid)
  const opts = { uid: true }
  switch (action) {
    case 'read':
      await client.messageFlagsAdd(uids, ['\\Seen'], opts)
      return
    case 'unread':
      await client.messageFlagsRemove(uids, ['\\Seen'], opts)
      return
    case 'flag':
      await client.messageFlagsAdd(uids, ['\\Flagged'], opts)
      return
    case 'unflag':
      await client.messageFlagsRemove(uids, ['\\Flagged'], opts)
      return
  }

  if (action === 'move') {
    const dest = folders.find((f) => f.id === destFolderId)
    if (!dest) throw new Error('Dossier de destination introuvable.')
    if (dest.path !== folder.path) await client.messageMove(uids, dest.path, opts)
    return
  }

  const role = MOVE_ROLE[action]!
  if (role === 'trash' && folder.role === 'trash') {
    await client.messageDelete(uids, opts)
    return
  }
  // Gmail archives by moving to "All Mail"; elsewhere use (or create) an Archive folder.
  let dest = folders.find((f) => f.role === role) ?? (kind === 'google' && role === 'archive' ? folders.find((f) => f.role === 'all') : undefined)
  if (!dest && role === 'archive') {
    const created = await client.mailboxCreate('Archive')
    dest = { id: '', account_id: folder.account_id, path: created.path, name: 'Archive', role: 'archive', uidvalidity: null }
  }
  if (!dest) throw new Error(`Aucun dossier « ${role} » sur ce compte.`)
  if (dest.path === folder.path) return
  await client.messageMove(uids, dest.path, opts)
}

/** Resolves a thread-level action to concrete message ids. */
export function threadTargets(accountId: string, threadId: string, folderId: string, action: MessageAction): string[] {
  const db = getDb()
  if (action === 'read' || action === 'unread' || action === 'unflag') {
    return (
      db.prepare('SELECT id FROM messages WHERE account_id = ? AND thread_id = ?').all(accountId, threadId) as { id: string }[]
    ).map((r) => r.id)
  }
  if (action === 'flag') {
    const latest = db
      .prepare('SELECT id FROM messages WHERE account_id = ? AND thread_id = ? AND folder_id = ? ORDER BY date DESC LIMIT 1')
      .get(accountId, threadId, folderId) as { id: string } | undefined
    return latest ? [latest.id] : []
  }
  return (
    db
      .prepare('SELECT id FROM messages WHERE account_id = ? AND thread_id = ? AND folder_id = ?')
      .all(accountId, threadId, folderId) as { id: string }[]
  ).map((r) => r.id)
}
