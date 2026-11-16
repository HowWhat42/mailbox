import type { MessageAction, OutgoingMessage, QueuedSend } from '@shared/types'
import { getDb } from '../db'
import { emit } from '../events'

/**
 * Changes made while the server can't be reached. The local database already shows them;
 * this table remembers what to replay on the server once the connection is back.
 */

export interface QueuedAction {
  kind: 'action'
  folderId: string
  uids: number[]
  action: MessageAction
  destFolderId?: string
}

export interface QueuedMessage {
  kind: 'send'
  message: OutgoingMessage
}

type Op = QueuedAction | QueuedMessage

const OFFLINE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENETDOWN',
  'EPIPE',
  'NoConnection',
  'ECONNECTION',
  'ESOCKET',
  'EDNS'
])

/** Network failure (worth retrying later), as opposed to the server refusing the request. */
export function isOffline(err: unknown): boolean {
  let e = err as { code?: string; cause?: unknown; message?: string } | undefined
  for (let depth = 0; e && depth < 4; depth++) {
    if (e.code && OFFLINE_CODES.has(e.code)) return true
    if (/getaddrinfo|socket hang up|connection (closed|timeout|refused)|network/i.test(e.message ?? '')) return true
    e = e.cause as typeof e
  }
  return false
}

export function enqueue(accountId: string, op: Op): void {
  getDb()
    .prepare('INSERT INTO pending_ops (account_id, kind, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(accountId, op.kind, JSON.stringify(op), Date.now())
  emit('queue:changed', {})
}

interface Row {
  id: number
  account_id: string
  kind: Op['kind']
  payload: string
  created_at: number
  last_error: string | null
}

function pendingFor(accountId: string): Row[] {
  return getDb().prepare('SELECT * FROM pending_ops WHERE account_id = ? ORDER BY id').all(accountId) as unknown as Row[]
}

export function pendingActionCount(): number {
  return (getDb().prepare("SELECT count(*) AS n FROM pending_ops WHERE kind = 'action'").get() as { n: number }).n
}

export function outbox(): QueuedSend[] {
  const rows = getDb().prepare("SELECT * FROM pending_ops WHERE kind = 'send' ORDER BY id").all() as unknown as Row[]
  return rows.map((r) => {
    const { message } = JSON.parse(r.payload) as QueuedMessage
    return { id: r.id, accountId: r.account_id, to: message.to, subject: message.subject, createdAt: r.created_at, lastError: r.last_error }
  })
}

/** Takes a queued message back out of the outbox (to edit it or drop it). */
export function takeFromOutbox(id: number): OutgoingMessage | null {
  const row = getDb().prepare("SELECT payload FROM pending_ops WHERE id = ? AND kind = 'send'").get(id) as { payload: string } | undefined
  if (!row) return null
  getDb().prepare('DELETE FROM pending_ops WHERE id = ?').run(id)
  emit('queue:changed', {})
  return (JSON.parse(row.payload) as QueuedMessage).message
}

export interface Replayers {
  action: (accountId: string, op: QueuedAction) => Promise<void>
  send: (message: OutgoingMessage) => Promise<unknown>
}

const flushing = new Set<string>()

/**
 * Replays an account's queued changes in order. Stops at the first network failure
 * (still offline); drops an operation the server rejects for good, so one bad change
 * can't block everything behind it.
 */
export async function flushQueue(accountId: string, replay: Replayers): Promise<void> {
  if (flushing.has(accountId)) return
  flushing.add(accountId)
  try {
    for (const row of pendingFor(accountId)) {
      const op = JSON.parse(row.payload) as Op
      try {
        if (op.kind === 'action') await replay.action(accountId, op)
        else await replay.send(op.message)
        getDb().prepare('DELETE FROM pending_ops WHERE id = ?').run(row.id)
      } catch (err) {
        if (isOffline(err)) break
        const message = (err as Error).message
        if (op.kind === 'send') {
          // Keep the message: the user decides what to do with it from the outbox.
          getDb().prepare('UPDATE pending_ops SET last_error = ? WHERE id = ?').run(message, row.id)
        } else {
          getDb().prepare('DELETE FROM pending_ops WHERE id = ?').run(row.id)
        }
      } finally {
        emit('queue:changed', {})
      }
    }
  } finally {
    flushing.delete(accountId)
  }
}
