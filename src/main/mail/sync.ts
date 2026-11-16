import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { Notification } from 'electron'
import type { ImapFlow, ListResponse, MailboxObject, MessageStructureObject } from 'imapflow'
import type { Account, FolderRole } from '@shared/types'
import { dataDir, getDb, tx } from '../db'
import { emit } from '../events'
import { getAccount, setSyncResult } from '../accounts/store'
import { forgetGoogleToken } from '../accounts/google'
import { inMailbox, withImap } from './imap'
import { idList, parseFull, previewFromPartialSource } from './parse'

/** Newest messages pulled per folder on first sync. Older mail stays on the server. */
const INITIAL_WINDOW = 400
const FETCH_BATCH = 50

const ROLE_BY_SPECIAL_USE: Record<string, FolderRole> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Junk': 'junk',
  '\\Archive': 'archive',
  '\\All': 'all',
  '\\Flagged': 'flagged'
}

/** Folders that only mirror messages stored elsewhere (Gmail): not synced, still usable as move targets. */
const MIRROR_ROLES = new Set<FolderRole>(['all', 'flagged'])

export interface FolderRow {
  id: string
  account_id: string
  path: string
  name: string
  role: FolderRole
  uidvalidity: string | null
}

const running = new Map<string, Promise<void>>()

export function syncAccount(accountId: string, opts: { inboxOnly?: boolean } = {}): Promise<void> {
  const key = `${accountId}:${opts.inboxOnly ? 'inbox' : 'all'}`
  const current = running.get(key)
  if (current) return current
  const job = runSync(accountId, opts.inboxOnly ?? false).finally(() => running.delete(key))
  running.set(key, job)
  return job
}

async function runSync(accountId: string, inboxOnly: boolean): Promise<void> {
  const account = getAccount(accountId)
  emit('sync:status', { accountId, state: 'syncing', message: null })
  try {
    await withImap(account, async (client) => {
      const folders = inboxOnly ? foldersOf(accountId).filter((f) => f.role === 'inbox') : await syncFolderList(client, account)
      const order = [...folders].sort((a, b) => rank(a.role) - rank(b.role))
      for (const folder of order) {
        if (MIRROR_ROLES.has(folder.role)) continue
        await syncFolder(client, account, folder)
        emit('mail:changed', { accountId })
      }
    })
    setSyncResult(accountId, null)
    emit('sync:status', { accountId, state: 'idle', message: null })
  } catch (err) {
    const message = describeError(err)
    if (account.kind === 'google') forgetGoogleToken(accountId)
    setSyncResult(accountId, message)
    emit('sync:status', { accountId, state: 'error', message })
    throw new Error(message)
  }
}

export function describeError(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; responseText?: string; message?: string; code?: string }
  if (e?.authenticationFailed) return 'Authentification refusée par le serveur.'
  if (e?.code === 'ENOTFOUND') return 'Serveur introuvable.'
  if (e?.code === 'ECONNREFUSED') return 'Connexion refusée par le serveur.'
  if (e?.code === 'ETIMEDOUT') return 'Le serveur ne répond pas.'
  return e?.responseText || e?.message || String(err)
}

function rank(role: FolderRole): number {
  return ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash'].indexOf(role ?? '') >>> 0
}

export function foldersOf(accountId: string): FolderRow[] {
  return getDb().prepare('SELECT * FROM folders WHERE account_id = ?').all(accountId) as unknown as FolderRow[]
}

function folderId(accountId: string, path: string): string {
  return createHash('sha1').update(`${accountId}\0${path}`).digest('hex').slice(0, 16)
}

async function syncFolderList(client: ImapFlow, account: Account): Promise<FolderRow[]> {
  const remote = (await client.list()).filter((f: ListResponse) => !f.flags.has('\\Noselect') && !f.flags.has('\\NonExistent'))
  const db = getDb()
  tx(() => {
    const upsert = db.prepare(
      `INSERT INTO folders (id, account_id, path, name, role) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (account_id, path) DO UPDATE SET name = excluded.name, role = excluded.role`
    )
    for (const f of remote) {
      const role = f.path.toUpperCase() === 'INBOX' ? 'inbox' : (ROLE_BY_SPECIAL_USE[f.specialUse ?? ''] ?? null)
      upsert.run(folderId(account.id, f.path), account.id, f.path, f.name, role)
    }
    const keep = new Set(remote.map((f) => f.path))
    for (const local of foldersOf(account.id)) {
      if (!keep.has(local.path)) db.prepare('DELETE FROM folders WHERE id = ?').run(local.id)
    }
  })
  return foldersOf(account.id)
}

function hasAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) return false
  if (node.disposition === 'attachment') return true
  if (node.childNodes?.length) return node.childNodes.some(hasAttachment)
  return false
}

export async function syncFolder(client: ImapFlow, account: Account, folder: FolderRow): Promise<void> {
  const db = getDb()
  await inMailbox(client, folder.path, async () => {
    const mailbox = client.mailbox as MailboxObject
    const uidvalidity = String(mailbox.uidValidity)
    if (folder.uidvalidity !== uidvalidity) {
      db.prepare('DELETE FROM messages WHERE folder_id = ?').run(folder.id)
      db.prepare('UPDATE folders SET uidvalidity = ? WHERE id = ?').run(uidvalidity, folder.id)
    }

    const remoteUids = mailbox.exists ? ((await client.search({ all: true }, { uid: true })) || []) : []
    const remoteSet = new Set(remoteUids)
    const localUids = (
      db.prepare('SELECT uid FROM messages WHERE folder_id = ?').all(folder.id) as { uid: number }[]
    ).map((r) => r.uid)
    const localSet = new Set(localUids)

    // 1. Expunged on the server.
    const gone = localUids.filter((uid) => !remoteSet.has(uid))
    if (gone.length) {
      tx(() => {
        const del = db.prepare('DELETE FROM messages WHERE folder_id = ? AND uid = ?')
        for (const uid of gone) del.run(folder.id, uid)
      })
    }

    // 2. Flag changes on what we already have.
    const kept = localUids.filter((uid) => remoteSet.has(uid))
    if (kept.length) {
      const minUid = kept.reduce((a, b) => Math.min(a, b))
      const update = db.prepare('UPDATE messages SET unread = ?, flagged = ? WHERE folder_id = ? AND uid = ?')
      const changes: [number, number, number][] = []
      for await (const msg of client.fetch(`${minUid}:*`, { uid: true, flags: true }, { uid: true })) {
        if (!localSet.has(msg.uid) || !msg.flags) continue
        changes.push([msg.flags.has('\\Seen') ? 0 : 1, msg.flags.has('\\Flagged') ? 1 : 0, msg.uid])
      }
      tx(() => {
        for (const [unread, flagged, uid] of changes) update.run(unread, flagged, folder.id, uid)
      })
    }

    // 3. New messages: newer than our window, or the newest N on first sync.
    const minLocal = kept.length ? kept.reduce((a, b) => Math.min(a, b)) : 0
    let fresh = remoteUids.filter((uid) => !localSet.has(uid) && uid > minLocal).sort((a, b) => b - a)
    fresh = fresh.slice(0, INITIAL_WINDOW)
    const notifyNew = folder.role === 'inbox' && kept.length > 0
    const newUnread: { from: string; subject: string }[] = []

    for (let i = 0; i < fresh.length; i += FETCH_BATCH) {
      const batch = fresh.slice(i, i + FETCH_BATCH)
      const rows: unknown[][] = []
      for await (const msg of client.fetch(
        batch,
        {
          uid: true,
          flags: true,
          envelope: true,
          internalDate: true,
          bodyStructure: true,
          threadId: true,
          headers: ['references'],
          source: { maxLength: 24_000 }
        },
        { uid: true }
      )) {
        const env = msg.envelope
        const refs = idList(msg.headers?.toString('utf8'))
        const msgId = env?.messageId?.replace(/^<|>$/g, '') ?? null
        const inReplyTo = idList(env?.inReplyTo)[0]
        const root = refs[0] ?? inReplyTo ?? msgId ?? `${folder.id}:${msg.uid}`
        const threadId = msg.threadId ? `g:${msg.threadId}` : `r:${root}`
        const from = env?.from?.[0]
        const date = (env?.date ?? msg.internalDate ?? new Date()) as Date | string
        const unread = msg.flags?.has('\\Seen') ? 0 : 1
        const snippet = msg.source ? await previewFromPartialSource(msg.source) : ''
        rows.push([
          `${folder.id}:${msg.uid}`,
          account.id,
          folder.id,
          msg.uid,
          threadId,
          msgId,
          JSON.stringify(inReplyTo && !refs.includes(inReplyTo) ? [...refs, inReplyTo] : refs),
          env?.subject ?? '',
          from?.name ?? '',
          from?.address ?? '',
          JSON.stringify((env?.to ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }))),
          JSON.stringify((env?.cc ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }))),
          JSON.stringify((env?.replyTo ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }))),
          new Date(date).getTime() || Date.now(),
          snippet,
          unread,
          msg.flags?.has('\\Flagged') ? 1 : 0,
          hasAttachment(msg.bodyStructure) ? 1 : 0
        ])
        if (notifyNew && unread) newUnread.push({ from: from?.name || from?.address || '', subject: env?.subject ?? '' })
      }
      tx(() => {
        const insert = db.prepare(
          `INSERT OR IGNORE INTO messages (id, account_id, folder_id, uid, thread_id, message_id_header, refs, subject,
             from_name, from_addr, to_json, cc_json, reply_to_json, date, snippet, unread, flagged, has_attachments)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const row of rows) insert.run(...(row as (string | number | null)[]))
      })
    }

    const unseen = mailbox.exists ? ((await client.search({ seen: false }, { uid: true })) || []).length : 0
    db.prepare('UPDATE folders SET unread = ?, total = ? WHERE id = ?').run(unseen, mailbox.exists, folder.id)
    notify(account, newUnread)
  })
}

function notify(account: Account, items: { from: string; subject: string }[]): void {
  if (!items.length || !Notification.isSupported()) return
  const body = items.length === 1 ? items[0].subject || '(sans objet)' : `${items.length} nouveaux messages`
  const title = items.length === 1 ? items[0].from : account.name
  new Notification({ title, body, silent: false }).show()
}

/** Downloads and caches the full source of messages that have no body yet. */
export async function ensureBodies(messageIds: string[]): Promise<void> {
  const db = getDb()
  if (!messageIds.length) return
  const placeholders = messageIds.map(() => '?').join(',')
  const missing = db
    .prepare(
      `SELECT m.id, m.uid, m.account_id, f.path, f.id AS folder_id FROM messages m JOIN folders f ON f.id = m.folder_id
       WHERE m.id IN (${placeholders}) AND m.eml_path IS NULL`
    )
    .all(...messageIds) as { id: string; uid: number; account_id: string; path: string; folder_id: string }[]
  if (!missing.length) return

  const byAccount = Map.groupBy(missing, (m) => m.account_id)
  for (const [accountId, msgs] of byAccount) {
    const account = getAccount(accountId)
    await withImap(account, async (client) => {
      for (const [path, inFolder] of Map.groupBy(msgs, (m) => m.path)) {
        await inMailbox(client, path, async () => {
          for (const m of inFolder) {
            const fetched = await client.fetchOne(String(m.uid), { source: true }, { uid: true })
            if (!fetched || !fetched.source) continue
            await storeBody(m.id, accountId, fetched.source)
          }
        })
      }
    })
  }
}

export async function storeBody(messageId: string, accountId: string, source: Buffer): Promise<void> {
  const file = join(dataDir('eml', accountId), `${createHash('sha1').update(messageId).digest('hex')}.eml`)
  await writeFile(file, source)
  const body = await parseFull(source)
  getDb()
    .prepare('UPDATE messages SET body_html = ?, body_text = ?, attachments_json = ?, eml_path = ?, has_attachments = ? WHERE id = ?')
    .run(body.html, body.text, JSON.stringify(body.attachments), file, body.attachments.length ? 1 : 0, messageId)
}
