import { MAIL_CATEGORIES, type Address, type Bundle, type Folder, type MailCategory, type MailFilter, type MailScope, type MailView, type MessageDetail, type ThreadSummary } from '@shared/types'
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
  role: Folder['role']
  category: MailCategory
  list_unsubscribe: string | null
}

/** Groups the matching messages by thread and keeps the newest one per thread. */
function summaries(where: string, params: (string | number)[], limit: number): ThreadSummary[] {
  const rows = getDb()
    .prepare(
      `WITH v AS (
         SELECT m.*, f.role FROM messages m JOIN folders f ON f.id = m.folder_id WHERE ${where}
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
    folderRole: r.role,
    subject: r.subject,
    snippet: r.snippet,
    from: { name: r.from_name, address: r.from_addr },
    to: JSON.parse(r.to_json) as Address[],
    participants: [...new Set((r.senders ?? '').split('\u0001').filter(Boolean))],
    date: r.date,
    unread: !!r.any_unread,
    flagged: !!r.any_flagged,
    hasAttachments: !!r.any_att,
    count: r.cnt,
    category: r.category,
    canUnsubscribe: !!r.list_unsubscribe
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

const FILTERS: Record<MailFilter, string> = {
  all: '1',
  unread: 'm.unread = 1',
  flagged: 'm.flagged = 1',
  attachments: 'm.has_attachments = 1'
}

/**
 * Note: filters apply per message, so a thread shows up under "Non lus" when any
 * of its messages in the view is unread, and the row then shows that message.
 */
/** Accounts the user chose to keep out of the unified boxes. */
const UNIFIED = 'm.account_id IN (SELECT id FROM accounts WHERE in_unified = 1)'

function scopeClause(scope: MailScope): { sql: string; params: string[] } {
  if (scope === 'all') return { sql: '', params: [] }
  if (typeof scope === 'string') return MAIL_CATEGORIES.includes(scope) ? { sql: ' AND m.category = ?', params: [scope] } : { sql: '', params: [] }
  const excluded = scope.exclude.filter((c) => MAIL_CATEGORIES.includes(c))
  return excluded.length ? { sql: ` AND m.category NOT IN (${excluded.map(() => '?').join(',')})`, params: excluded } : { sql: '', params: [] }
}

export function listThreads(view: MailView, filter: MailFilter, scope: MailScope, limit: number): ThreadSummary[] {
  const s = scopeClause(scope)
  const params: (string | number)[] = [...s.params]
  const f = (FILTERS[filter] ?? '1') + s.sql
  switch (view.type) {
    case 'folder':
      return summaries(`m.folder_id = ? AND ${f}`, [view.folderId, ...params], limit)
    case 'unified':
      if (view.role === 'flagged') return summaries(`m.flagged = 1 AND coalesce(f.role, '') NOT IN ('trash', 'junk') AND ${UNIFIED} AND ${f}`, params, limit)
      return summaries(`f.role = ? AND ${UNIFIED} AND ${f}`, [view.role, ...params], limit)
    case 'search': {
      const q = ftsQuery(view.query)
      if (!q) return []
      return summaries(`m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?) AND ${f}`, [q, ...params], limit)
    }
  }
}

/** WHERE clause selecting the inbox a view stands for (unified or one account's). */
function inboxOf(view: MailView): { sql: string; params: string[] } | null {
  if (view.type === 'unified' && view.role === 'inbox') return { sql: `f.role = 'inbox' AND ${UNIFIED}`, params: [] }
  if (view.type === 'folder') return { sql: 'm.folder_id = ?', params: [view.folderId] }
  return null
}

/** Spark-style bundles: each category of the inbox summarised by its senders. */
export function listBundles(view: MailView, categories: MailCategory[]): Bundle[] {
  const box = inboxOf(view)
  if (!box) return []
  const db = getDb()
  const out: Bundle[] = []
  for (const category of categories) {
    const where = `FROM messages m JOIN folders f ON f.id = m.folder_id WHERE ${box.sql} AND m.category = ?`
    const totals = db
      .prepare(
        `SELECT count(DISTINCT m.account_id || m.thread_id) AS threads,
                count(DISTINCT CASE WHEN m.unread = 1 THEN m.account_id || m.thread_id END) AS unread,
                max(m.date) AS latest ${where}`
      )
      .get(...box.params, category) as { threads: number; unread: number; latest: number | null }
    if (!totals.threads) continue
    const senders = db
      .prepare(
        `SELECT max(coalesce(nullif(m.from_name, ''), m.from_addr)) AS name, lower(m.from_addr) AS address,
                count(*) AS count, sum(m.unread) AS unread, max(m.date) AS last
         ${where} GROUP BY lower(m.from_addr) ORDER BY last DESC`
      )
      .all(...box.params, category) as { name: string; address: string; count: number; unread: number }[]
    out.push({
      category,
      threads: totals.threads,
      unread: totals.unread,
      latest: totals.latest ?? 0,
      senders: senders.slice(0, 6).map((s) => ({ name: s.name, address: s.address, count: s.count, unread: s.unread })),
      moreSenders: Math.max(0, senders.length - 6)
    })
  }
  return out
}

/** Message ids of a bundle, for "mark all read" / "archive all". */
export function bundleMessageIds(view: MailView, category: MailCategory, unreadOnly: boolean): string[] {
  const box = inboxOf(view)
  if (!box) return []
  return (
    getDb()
      .prepare(
        `SELECT m.id FROM messages m JOIN folders f ON f.id = m.folder_id
         WHERE ${box.sql} AND m.category = ?${unreadOnly ? ' AND m.unread = 1' : ''}`
      )
      .all(...box.params, category) as { id: string }[]
  ).map((r) => r.id)
}

/** Correspondents matching `query`, most frequent first: the composer's autocomplete. */
export function searchContacts(query: string): Address[] {
  const q = `%${query.trim().replace(/[%_]/g, '')}%`
  if (q === '%%') return []
  const own = new Set(
    (getDb().prepare('SELECT lower(email) AS e FROM accounts').all() as { e: string }[]).map((r) => r.e)
  )
  const rows = getDb()
    .prepare(
      `WITH a AS (
         SELECT from_name AS name, from_addr AS address, date FROM messages
         UNION ALL
         SELECT json_extract(j.value, '$.name'), json_extract(j.value, '$.address'), m.date
           FROM messages m, json_each(m.to_json) j
         UNION ALL
         SELECT json_extract(j.value, '$.name'), json_extract(j.value, '$.address'), m.date
           FROM messages m, json_each(m.cc_json) j
       )
       SELECT lower(address) AS address, max(coalesce(name, '')) AS name, count(*) AS n, max(date) AS last
       FROM a
       WHERE address <> '' AND (address LIKE ? OR name LIKE ?)
       GROUP BY lower(address)
       ORDER BY n DESC, last DESC
       LIMIT 12`
    )
    .all(q, q) as { address: string; name: string }[]
  return rows.filter((r) => !own.has(r.address)).slice(0, 8).map((r) => ({ name: r.name, address: r.address }))
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

/** Unread threads in the unified inbox (total and per smart-inbox category) and flagged threads. */
export function unifiedCounts(): { inbox: number; flagged: number; categories: Record<MailCategory, number> } {
  const db = getDb()
  const perCategory = db
    .prepare(
      `SELECT m.category, count(DISTINCT m.account_id || m.thread_id) AS n FROM messages m JOIN folders f ON f.id = m.folder_id
       WHERE f.role = 'inbox' AND m.unread = 1 AND ${UNIFIED} GROUP BY m.category`
    )
    .all() as { category: MailCategory; n: number }[]
  const categories = Object.fromEntries(MAIL_CATEGORIES.map((c) => [c, perCategory.find((r) => r.category === c)?.n ?? 0])) as Record<MailCategory, number>
  const inbox = db
    .prepare(
      `SELECT count(DISTINCT m.account_id || m.thread_id) AS n FROM messages m JOIN folders f ON f.id = m.folder_id
       WHERE f.role = 'inbox' AND m.unread = 1 AND ${UNIFIED}`
    )
    .get() as { n: number }
  const flagged = db
    .prepare(
      `SELECT count(DISTINCT m.account_id || m.thread_id) AS n FROM messages m JOIN folders f ON f.id = m.folder_id
       WHERE m.flagged = 1 AND coalesce(f.role, '') NOT IN ('trash', 'junk') AND ${UNIFIED}`
    )
    .get() as { n: number }
  return { inbox: inbox.n, flagged: flagged.n, categories }
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
  bcc_json: string
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
    bcc: JSON.parse(r.bcc_json) as Address[],
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
