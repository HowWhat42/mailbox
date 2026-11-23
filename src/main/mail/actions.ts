import type { ImapFlow } from 'imapflow'
import type { AccountKind, FolderRole, MessageAction } from '@shared/types'
import { getDb, tx } from '../db'
import { emit } from '../events'
import { getAccount } from '../accounts/store'
import { inMailbox, withImap } from './imap'
import { describeError, foldersOf, syncAccount, type FolderRow } from './sync'
import { enqueue, isOffline, type QueuedAction } from './queue'

interface Target {
  id: string
  uid: number
  account_id: string
  folder_id: string
  unread: number
  flagged: number
}

const MOVE_ROLE: Partial<Record<MessageAction, FolderRole>> = { archive: 'archive', trash: 'trash', junk: 'junk' }

/**
 * Messages changed locally whose server action hasn't finished yet (id -> number of actions on it).
 * A sync reading the folder meanwhile still sees the old server state: it must not bring them back.
 */
const inFlight = new Map<string, number>()

export function isInFlight(messageId: string): boolean {
  return inFlight.has(messageId)
}

function markInFlight(ids: string[], delta: 1 | -1): void {
  for (const id of ids) {
    const n = (inFlight.get(id) ?? 0) + delta
    if (n > 0) inFlight.set(id, n)
    else inFlight.delete(id)
  }
}

interface ServerJob {
  ops: QueuedAction[]
  resolve: () => void
  reject: (err: unknown) => void
}

/** Live actions waiting for the account's connection, so a burst of deletes doesn't open one connection each. */
const serverJobs = new Map<string, ServerJob[]>()
const draining = new Set<string>()

/** Runs `ops` on the server after the account's earlier actions, batched with any that pile up meanwhile. */
function runLive(accountId: string, ops: QueuedAction[]): Promise<void> {
  return new Promise((resolve, reject) => {
    serverJobs.set(accountId, [...(serverJobs.get(accountId) ?? []), { ops, resolve, reject }])
    if (!draining.has(accountId)) void drain(accountId)
  })
}

async function drain(accountId: string): Promise<void> {
  draining.add(accountId)
  try {
    for (;;) {
      const batch = serverJobs.get(accountId) ?? []
      serverJobs.delete(accountId)
      if (!batch.length) return
      try {
        await runOnServer(accountId, mergeOps(batch.flatMap((j) => j.ops)))
        for (const j of batch) j.resolve()
      } catch (err) {
        for (const j of batch) j.reject(err)
      }
    }
  } finally {
    draining.delete(accountId)
  }
}

/** Same action on the same folder: one IMAP command for all the uids. Order of first appearance is kept. */
function mergeOps(ops: QueuedAction[]): QueuedAction[] {
  const merged = new Map<string, QueuedAction>()
  for (const op of ops) {
    const key = `${op.folderId}\0${op.action}\0${op.destFolderId ?? ''}`
    const prev = merged.get(key)
    if (prev) prev.uids = [...prev.uids, ...op.uids]
    else merged.set(key, { ...op, uids: [...op.uids] })
  }
  return [...merged.values()]
}

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

  const ids = relevant.map((t) => t.id)
  // Released once the server is done and the sync after it has read the folder again.
  const followUps: Promise<void>[] = []
  markInFlight(ids, 1)
  try {
    await applyRelevant(relevant, action, followUps, destFolderId)
  } finally {
    void Promise.allSettled(followUps).then(() => markInFlight(ids, -1))
  }
}

async function applyRelevant(relevant: Target[], action: MessageAction, followUps: Promise<void>[], destFolderId?: string): Promise<void> {
  const db = getDb()
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
    const groups = [
      ...Map.groupBy(
        relevant.filter((t) => t.account_id === accountId),
        (t) => t.folder_id
      )
    ].map(([folderId, msgs]): QueuedAction => ({ kind: 'action', folderId, uids: msgs.map((m) => m.uid), action, destFolderId }))
    try {
      await runLive(accountId, groups)
    } catch (err) {
      if (isOffline(err)) {
        // Offline: keep the local change and replay it when the server is back.
        for (const g of groups) enqueue(accountId, g)
        continue
      }
      void syncAccount(accountId).catch(() => {})
      throw new Error(describeError(err), { cause: err })
    }
    if (MOVE_ROLE[action] || action === 'move') followUps.push(syncAccount(accountId).catch(() => {}))
  }
}

/** Empties Trash or Junk for good (server and local copy). Returns how many messages went. */
export async function emptyFolder(folderId: string): Promise<number> {
  const db = getDb()
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as unknown as FolderRow | undefined
  if (!folder) throw new Error('Dossier introuvable.')
  if (folder.role !== 'trash' && folder.role !== 'junk') throw new Error('Seuls la corbeille et les indésirables peuvent être vidés.')
  try {
    await withImap(getAccount(folder.account_id), (client) =>
      inMailbox(client, folder.path, async () => {
        if ((client.mailbox as { exists?: number }).exists) await client.messageDelete('1:*')
      })
    )
  } catch (err) {
    if (isOffline(err)) throw new Error('Hors ligne : le dossier sera vidable au retour de la connexion.', { cause: err })
    throw new Error(describeError(err), { cause: err })
  }
  const n = (db.prepare('SELECT count(*) AS n FROM messages WHERE folder_id = ?').get(folder.id) as { n: number }).n
  db.prepare('DELETE FROM messages WHERE folder_id = ?').run(folder.id)
  db.prepare('UPDATE folders SET unread = 0, total = 0 WHERE id = ?').run(folder.id)
  emit('mail:changed', { accountId: folder.account_id })
  return n
}

/** Performs queued or live actions on the server, one connection for all of them. */
export async function runOnServer(accountId: string, ops: QueuedAction[]): Promise<void> {
  const account = getAccount(accountId)
  const folders = foldersOf(accountId)
  await withImap(account, async (client) => {
    for (const op of ops) {
      const folder = folders.find((f) => f.id === op.folderId)
      if (!folder) continue
      await inMailbox(client, folder.path, () => serverAction(client, account.kind, folders, folder, op.uids, op.action, op.destFolderId))
    }
  })
}

async function serverAction(
  client: ImapFlow,
  kind: AccountKind,
  folders: FolderRow[],
  folder: FolderRow,
  uids: number[],
  action: MessageAction,
  destFolderId?: string
): Promise<void> {
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
    return (db.prepare('SELECT id FROM messages WHERE account_id = ? AND thread_id = ?').all(accountId, threadId) as { id: string }[]).map(
      (r) => r.id
    )
  }
  if (action === 'flag') {
    const latest = db
      .prepare('SELECT id FROM messages WHERE account_id = ? AND thread_id = ? AND folder_id = ? ORDER BY date DESC LIMIT 1')
      .get(accountId, threadId, folderId) as { id: string } | undefined
    return latest ? [latest.id] : []
  }
  return (
    db.prepare('SELECT id FROM messages WHERE account_id = ? AND thread_id = ? AND folder_id = ?').all(accountId, threadId, folderId) as {
      id: string
    }[]
  ).map((r) => r.id)
}
