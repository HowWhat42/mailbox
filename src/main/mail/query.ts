import type { Address, Folder, MailView, MessageDetail, ThreadSummary } from '@shared/types'
import { getDb } from '../db'
import { ensureBodies } from './sync'

interface SummaryRow {
  id: string
  account_id: string
  folder_id: string
  thread_id: string
  subject: string
  snippet: string
  from_name: string
  from_addr: string
  to_json: string
  date: number
  cnt: number
  any_unread: number
  any_flagged: number
  any_att: number
  senders: string | null
}

/** Groups the matching messages by thread and keeps the newest one per thread. */
function summaries(where: string, params: (string | number)[], limit: number): ThreadSummary[] {
  const rows = getDb()
    .prepare(
      `WITH v AS (
         SELECT m.* FROM messages m JOIN folders f ON f.id = m.folder_id WHERE ${where}
       ), ranked AS (
         SELECT v.*,
           row_number() OVER w_desc AS rn,
           count(*) OVER w AS cnt,
           max(unread) OVER w AS any_unread,
           max(flagged) OVER w AS any_flagged,
           max(has_attachments) OVER w AS any_att,
           group_concat(coalesce(nullif(from_name, ''), from_addr), char(1)) OVER w AS senders
         FROM v
         WINDOW w AS (PARTITION BY account_id, thread_id),
                w_desc AS (PARTITION BY account_id, thread_id ORDER BY date DESC)
       )
       SELECT * FROM ranked WHERE rn = 1 ORDER BY date DESC LIMIT ?`
    )
    .all(...params, limit) as unknown as SummaryRow[]
  return rows.map((r) => ({
    threadId: r.thread_id,
    accountId: r.account_id,
    messageId: r.id,
    folderId: r.folder_id,
    subject: r.subject,
    snippet: r.snippet,
    from: { name: r.from_name, address: r.from_addr },
    to: JSON.parse(r.to_json) as Address[],
    participants: [...new Set((r.senders ?? '').split('\u0001').filter(Boolean))],
    date: r.date,
    unread: !!r.any_unread,
    flagged: !!r.any_flagged,
    hasAttachments: !!r.any_att,
    count: r.cnt
  }))
}

/** Turns free text into an FTS5 prefix query, so users never hit FTS syntax errors. */
function ftsQuery(input: string): string {
  return input
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' ')
}

export function listThreads(view: MailView, limit: number): ThreadSummary[] {
  switch (view.type) {
    case 'folder':
      return summaries('m.folder_id = ?', [view.folderId], limit)
    case 'unified':
      if (view.role === 'flagged') return summaries("m.flagged = 1 AND coalesce(f.role, '') NOT IN ('trash', 'junk')", [], limit)
      return summaries('f.role = ?', [view.role], limit)
    case 'search': {
      const q = ftsQuery(view.query)
      if (!q) return []
      return summaries('m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)', [q], limit)
    }
  }
}

export function listFolders(): Folder[] {
  const rows = getDb()
    .prepare('SELECT id, account_id, path, name, role, unread, total FROM folders ORDER BY path COLLATE NOCASE')
    .all() as { id: string; account_id: string; path: string; name: string; role: Folder['role']; unread: number; total: number }[]
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    path: r.path,
    name: r.name,
    role: r.role,
    unread: r.unread,
    total: r.total
  }))
}

export function unifiedCounts(): { inbox: number; flagged: number } {
  const db = getDb()
  const inbox = db
    .prepare(
      `SELECT count(DISTINCT m.account_id || m.thread_id) AS n FROM messages m JOIN folders f ON f.id = m.folder_id
       WHERE f.role = 'inbox' AND m.unread = 1`
    )
    .get() as { n: number }
  const flagged = db
    .prepare(
      `SELECT count(DISTINCT m.account_id || m.thread_id) AS n FROM messages m JOIN folders f ON f.id = m.folder_id
       WHERE m.flagged = 1 AND coalesce(f.role, '') NOT IN ('trash', 'junk')`
    )
    .get() as { n: number }
  return { inbox: inbox.n, flagged: flagged.n }
}

interface DetailRow {
  id: string
  account_id: string
  folder_id: string
  thread_id: string
  subject: string
  from_name: string
  from_addr: string
  to_json: string
  cc_json: string
  reply_to_json: string
  date: number
  unread: number
  flagged: number
  message_id_header: string | null
  refs: string
  body_html: string | null
  body_text: string | null
  attachments_json: string | null
  role: string | null
}

export async function threadMessages(accountId: string, threadId: string): Promise<MessageDetail[]> {
  const select = (): DetailRow[] =>
    getDb()
      .prepare(
        `SELECT m.*, f.role FROM messages m JOIN folders f ON f.id = m.folder_id
         WHERE m.account_id = ? AND m.thread_id = ? ORDER BY m.date ASC`
      )
      .all(accountId, threadId) as unknown as DetailRow[]

  // The same message can live in several folders (Gmail labels, a copy in Sent): keep one, preferring non-trash.
  const pick = (rows: DetailRow[]): DetailRow[] => {
    const byMsgId = new Map<string, DetailRow>()
    for (const r of rows) {
      const key = r.message_id_header ?? r.id
      const prev = byMsgId.get(key)
      if (!prev || (prev.role === 'trash' && r.role !== 'trash')) byMsgId.set(key, r)
    }
    return [...byMsgId.values()].sort((a, b) => a.date - b.date)
  }

  await ensureBodies(pick(select()).map((r) => r.id))
  return pick(select()).map((r) => ({
    id: r.id,
    accountId: r.account_id,
    folderId: r.folder_id,
    threadId: r.thread_id,
    subject: r.subject,
    from: { name: r.from_name, address: r.from_addr },
    to: JSON.parse(r.to_json) as Address[],
    cc: JSON.parse(r.cc_json) as Address[],
    replyTo: JSON.parse(r.reply_to_json) as Address[],
    date: r.date,
    unread: !!r.unread,
    flagged: !!r.flagged,
    messageIdHeader: r.message_id_header,
    references: JSON.parse(r.refs) as string[],
    html: r.body_html,
    text: r.body_text,
    attachments: r.attachments_json ? JSON.parse(r.attachments_json) : []
  }))
}
