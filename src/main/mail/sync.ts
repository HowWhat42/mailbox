import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { Notification } from 'electron'
import type { ImapFlow, ListResponse, MailboxObject, MessageStructureObject } from 'imapflow'
import type { Account, FolderRole, MailCategory, RuleActions } from '@shared/types'
import { dataDir, getDb, tx } from '../db'
import { emit } from '../events'
import { getAccount, setSyncResult } from '../accounts/store'
import { forgetGoogleToken } from '../accounts/google'
import { inMailbox, withImap } from './imap'
import { idList, parseFull, previewFromPartialSource } from './parse'
import { classify, parseHeaders, signalsFrom, TRIAGE_HEADERS } from './triage'
import { knownContacts, listRules, reapplyRules } from './rules'
import { getSettings, inQuietHours } from '../settings'
import { flushQueue, isOffline } from './queue'
import { runOnServer } from './actions'
import { sendMessage } from './send'

/** Newest messages pulled per folder on first sync. Older mail stays on the server. */
const INITIAL_WINDOW = 400
const FETCH_BATCH = 50
/** Bytes of each new message fetched during sync: enough for the preview, and the whole of most personal mail. */
const PREVIEW_BYTES = 24_000
/** Bodies downloaded ahead after a sync, so opening recent mail needs no network. */
const PREFETCH = { count: 50, maxMessageBytes: 2_000_000, maxTotalBytes: 30_000_000 }

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

/** Gmail's own labels and the usual IMAP keywords: state, not something the user filed the mail under. */
const SYSTEM_LABELS = new Set(['\\inbox', '\\sent', '\\important', '\\starred', '\\draft', '\\drafts', '\\trash', '\\spam', '\\all'])
// Keywords starting with $ are set by software ($Forwarded, $Junk, $MDNSent, server markers…), not by people.
const SYSTEM_KEYWORDS = /^(\$|(non)?junk$)/i
/** Thunderbird's built-in tags. */
const THUNDERBIRD_TAGS: Record<string, string> = {
  $label1: 'Important',
  $label2: 'Travail',
  $label3: 'Personnel',
  $label4: 'À faire',
  $label5: 'Plus tard'
}

/** Labels of a message: Gmail labels when the server has them, plus keywords set by other clients. */
function labelsOf(flags: Set<string> | undefined, gmailLabels: Set<string> | undefined): string[] {
  const out = new Set<string>()
  for (const l of gmailLabels ?? []) if (!SYSTEM_LABELS.has(l.toLowerCase())) out.add(l)
  for (const f of flags ?? []) {
    if (f.startsWith('\\')) continue
    const tb = THUNDERBIRD_TAGS[f.toLowerCase()]
    if (tb) out.add(tb)
    // Keywords can't hold spaces: Mailbox writes them as underscores (see labels.ts).
    else if (!SYSTEM_KEYWORDS.test(f)) out.add(f.replace(/_/g, ' '))
  }
  return [...out]
}

/** Folders that only mirror messages stored elsewhere (Gmail): not synced, still usable as move targets. */
const MIRROR_ROLES = new Set<FolderRole>(['all', 'flagged', 'important'])

/** Servers without SPECIAL-USE: recognise the usual names (English, French, Outlook) of top-level folders. */
const ROLE_BY_NAME: [Exclude<FolderRole, null>, RegExp][] = [
  ['sent', /^(sent( items| messages| mail)?|envoy[ée]s|(é|e)l(é|e)ments envoy(é|e)s|messages envoy(é|e)s)$/i],
  ['trash', /^(trash|bin|deleted( items| messages)?|corbeille|(é|e)l(é|e)ments supprim(é|e)s)$/i],
  ['drafts', /^(drafts?|brouillons?)$/i],
  ['junk', /^(junk( e-?mail)?|spam|courrier ind(é|e)sirable|ind(é|e)sirables)$/i],
  ['archive', /^archives?$/i]
]

/** Role of each folder: INBOX, SPECIAL-USE flags (and Gmail's \Important), then names for roles still missing. */
function folderRoles(remote: ListResponse[]): Map<string, FolderRole> {
  const roles = new Map<string, FolderRole>()
  for (const f of remote) {
    const role =
      f.path.toUpperCase() === 'INBOX' ? 'inbox' : f.flags.has('\\Important') ? 'important' : (ROLE_BY_SPECIAL_USE[f.specialUse ?? ''] ?? null)
    roles.set(f.path, role)
  }
  const taken = new Set(roles.values())
  for (const f of remote) {
    if (roles.get(f.path)) continue
    // Top level only, or directly under INBOX ("INBOX.Sent" on Courier/Dovecot-style servers).
    const parent = f.parentPath ?? ''
    if (parent && parent.toUpperCase() !== 'INBOX') continue
    const match = ROLE_BY_NAME.find(([role, re]) => !taken.has(role) && re.test(f.name))
    if (match) {
      roles.set(f.path, match[0])
      taken.add(match[0])
    }
  }
  return roles
}

export interface FolderRow {
  id: string
  account_id: string
  path: string
  name: string
  role: FolderRole
  uidvalidity: string | null
}

const running = new Map<string, Promise<void>>()
/** Syncs asked for while one was already running: the running one may have read the folder too early. */
const rerun = new Set<string>()

export function syncAccount(accountId: string, opts: { inboxOnly?: boolean } = {}): Promise<void> {
  const key = `${accountId}:${opts.inboxOnly ? 'inbox' : 'all'}`
  const current = running.get(key)
  if (current) {
    // Mail that lands mid-sync (IDLE fires while bodies prefetch) would otherwise wait for the next poll.
    rerun.add(key)
    return current
  }
  const job = (async () => {
    do {
      rerun.delete(key)
      await runSync(accountId, opts.inboxOnly ?? false)
    } while (rerun.has(key))
  })().finally(() => {
    running.delete(key)
    rerun.delete(key)
  })
  running.set(key, job)
  return job
}

async function runSync(accountId: string, inboxOnly: boolean): Promise<void> {
  const account = getAccount(accountId)
  emit('sync:status', { accountId, state: 'syncing', message: null })
  // On a first sync, Sent arrives after the inbox: re-sort once we know who the user writes to.
  const firstSync = !(getDb().prepare('SELECT 1 FROM messages WHERE account_id = ? LIMIT 1').get(accountId) as unknown)
  try {
    // Offline changes go first, so the folder sync below doesn't undo them.
    await flushQueue(accountId, { action: (id, op) => runOnServer(id, [op]), send: (msg) => sendMessage(msg) })
    await withImap(account, async (client) => {
      const folders = inboxOnly ? foldersOf(accountId).filter((f) => f.role === 'inbox') : await syncFolderList(client, account)
      const order = folders.toSorted((a, b) => rank(a.role) - rank(b.role))
      for (const folder of order) {
        if (MIRROR_ROLES.has(folder.role)) continue
        await syncFolder(client, account, folder)
        emit('mail:changed', { accountId })
      }
      for (const folder of order.filter((f) => f.role === 'inbox')) await prefetchBodies(client, account, folder)
    })
    if (firstSync && !inboxOnly) reapplyRules()
    setSyncResult(accountId, null)
    emit('sync:status', { accountId, state: 'idle', message: null })
  } catch (err) {
    if (isOffline(err)) {
      // Not an account problem: keep the last error state, just say we're offline.
      emit('sync:status', { accountId, state: 'offline', message: 'Hors ligne' })
      throw err
    }
    const message = describeError(err)
    if (account.kind === 'google') forgetGoogleToken(accountId)
    setSyncResult(accountId, message)
    emit('sync:status', { accountId, state: 'error', message })
    throw new Error(message, { cause: err })
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

/**
 * Creates a folder on the server: under `parent`, or at the top of the account (inside the personal
 * namespace when the server has one, like "INBOX." on Courier/Dovecot setups). Returns its id.
 */
export async function createFolder(accountId: string, name: string, parentId?: string): Promise<string> {
  const clean = name.trim()
  if (!clean) throw new Error('Donnez un nom au dossier.')
  const account = getAccount(accountId)
  const parent = parentId ? (getDb().prepare('SELECT * FROM folders WHERE id = ?').get(parentId) as unknown as FolderRow | undefined) : undefined
  if (parentId && !parent) throw new Error('Dossier parent introuvable.')
  return withImap(account, async (client) => {
    const list = await client.list()
    const delimiter = list.find((f) => f.delimiter)?.delimiter ?? '/'
    if (clean.includes(delimiter)) throw new Error(`Le nom ne peut pas contenir « ${delimiter} ».`)
    const prefix = parent ? `${parent.path}${delimiter}` : (client.namespace?.prefix ?? '')
    const path = `${prefix}${clean}`
    if (list.some((f) => f.path.toLowerCase() === path.toLowerCase())) throw new Error(`« ${clean} » existe déjà ici.`)
    await client.mailboxCreate(path)
    await syncFolderList(client, account)
    emit('mail:changed', { accountId })
    return folderId(accountId, path)
  })
}

async function syncFolderList(client: ImapFlow, account: Account): Promise<FolderRow[]> {
  const remote = (await client.list()).filter((f: ListResponse) => !f.flags.has('\\Noselect') && !f.flags.has('\\NonExistent'))
  const db = getDb()
  tx(() => {
    const upsert = db.prepare(
      `INSERT INTO folders (id, account_id, path, name, role, parent_path) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (account_id, path) DO UPDATE SET name = excluded.name, role = excluded.role, parent_path = excluded.parent_path`
    )
    const roles = folderRoles(remote)
    for (const f of remote) upsert.run(folderId(account.id, f.path), account.id, f.path, f.name, roles.get(f.path) ?? null, f.parentPath || null)
    // Mirrors are never synced: drop copies stored back when they were taken for ordinary folders.
    db.prepare(
      `DELETE FROM messages WHERE folder_id IN (SELECT id FROM folders WHERE account_id = ? AND role IN (${[...MIRROR_ROLES].map(() => '?').join(',')}))`
    ).run(account.id, ...([...MIRROR_ROLES] as string[]))
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

    const remoteUids = mailbox.exists ? (await client.search({ all: true }, { uid: true })) || [] : []
    // Gmail exposes labels (X-GM-LABELS); elsewhere they are keywords among the flags.
    const gmail = client.capabilities.has('X-GM-EXT-1')
    const remoteSet = new Set(remoteUids)
    const localUids = (db.prepare('SELECT uid FROM messages WHERE folder_id = ?').all(folder.id) as { uid: number }[]).map((r) => r.uid)
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
      const update = db.prepare('UPDATE messages SET unread = ?, flagged = ?, labels = ? WHERE folder_id = ? AND uid = ?')
      const changes: [number, number, string, number][] = []
      for await (const msg of client.fetch(`${minUid}:*`, { uid: true, flags: true, labels: gmail }, { uid: true })) {
        if (!localSet.has(msg.uid) || !msg.flags) continue
        changes.push([msg.flags.has('\\Seen') ? 0 : 1, msg.flags.has('\\Flagged') ? 1 : 0, JSON.stringify(labelsOf(msg.flags, msg.labels)), msg.uid])
      }
      tx(() => {
        for (const [unread, flagged, labels, uid] of changes) update.run(unread, flagged, labels, folder.id, uid)
      })
    }

    // 3. New messages: newer than our window, or the newest N on first sync.
    const minLocal = kept.length ? kept.reduce((a, b) => Math.min(a, b)) : 0
    let fresh = remoteUids.filter((uid) => !localSet.has(uid) && uid > minLocal).toSorted((a, b) => b - a)
    fresh = fresh.slice(0, account.syncDepth || INITIAL_WINDOW)
    const notifyNew = folder.role === 'inbox' && kept.length > 0
    const newUnread: Incoming[] = []
    const rules = listRules()
    const contacts = knownContacts(account.id)
    const folders = foldersOf(account.id)

    for (let i = 0; i < fresh.length; i += FETCH_BATCH) {
      const batch = fresh.slice(i, i + FETCH_BATCH)
      const rows: unknown[][] = []
      // Rule actions to replay on the server for this batch, grouped by kind.
      const toRead: number[] = []
      const toStar: number[] = []
      const toMove = new Map<string, number[]>()
      const complete: [string, Buffer][] = []
      for await (const msg of client.fetch(
        batch,
        {
          uid: true,
          flags: true,
          envelope: true,
          internalDate: true,
          bodyStructure: true,
          threadId: true,
          labels: gmail,
          size: true,
          headers: TRIAGE_HEADERS,
          source: { maxLength: PREVIEW_BYTES }
        },
        { uid: true }
      )) {
        const env = msg.envelope
        const headers = parseHeaders(msg.headers?.toString('utf8'))
        const refs = idList(headers['references'])
        const msgId = env?.messageId?.replace(/^<|>$/g, '') ?? null
        const inReplyTo = idList(env?.inReplyTo)[0]
        const root = refs[0] ?? inReplyTo ?? msgId ?? `${folder.id}:${msg.uid}`
        const threadId = msg.threadId ? `g:${msg.threadId}` : `r:${root}`
        const from = env?.from?.[0]
        const date = (env?.date ?? msg.internalDate ?? new Date()) as Date | string
        const subject = env?.subject ?? ''
        const to = (env?.to ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }))
        const signals = signalsFrom(headers, msg.bodyStructure, subject)
        // Sent mail and drafts are ours: they are never "notifications".
        const own = folder.role === 'sent' || folder.role === 'drafts'
        const { category, actions } = own
          ? { category: 'people' as const, actions: {} as RuleActions }
          : classify(
              { fromAddr: from?.address ?? '', fromName: from?.name ?? '', to: to.map((a) => a.address), subject, signals },
              rules,
              account.id,
              contacts
            )
        const seen = msg.flags?.has('\\Seen') || !!actions.markRead
        const flagged = msg.flags?.has('\\Flagged') || !!actions.star
        if (actions.markRead && !msg.flags?.has('\\Seen')) toRead.push(msg.uid)
        if (actions.star && !msg.flags?.has('\\Flagged')) toStar.push(msg.uid)
        const dest = actions.moveTo ? folders.find((f) => f.id === actions.moveTo && f.id !== folder.id) : undefined
        if (dest) {
          toMove.set(dest.path, [...(toMove.get(dest.path) ?? []), msg.uid])
          continue
        }
        const snippet = msg.source ? await previewFromPartialSource(msg.source) : ''
        // Small mail fits in the preview bytes: that is the whole message, keep it and skip the download on open.
        if (msg.source && msg.size && msg.source.length >= msg.size) complete.push([`${folder.id}:${msg.uid}`, msg.source])
        rows.push([
          `${folder.id}:${msg.uid}`,
          account.id,
          folder.id,
          msg.uid,
          threadId,
          msgId,
          JSON.stringify(inReplyTo && !refs.includes(inReplyTo) ? [...refs, inReplyTo] : refs),
          subject,
          from?.name ?? '',
          from?.address ?? '',
          JSON.stringify(to),
          JSON.stringify((env?.cc ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }))),
          JSON.stringify((env?.replyTo ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }))),
          new Date(date).getTime() || Date.now(),
          snippet,
          seen ? 0 : 1,
          flagged ? 1 : 0,
          hasAttachment(msg.bodyStructure) ? 1 : 0,
          JSON.stringify((env?.bcc ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }))),
          category,
          JSON.stringify(signals),
          headers['list-unsubscribe'] ?? null,
          JSON.stringify(labelsOf(msg.flags, msg.labels))
        ])
        if (notifyNew && !seen && !actions.mute) newUnread.push({ from: from?.name || from?.address || '', subject, category })
      }
      tx(() => {
        const insert = db.prepare(
          `INSERT OR IGNORE INTO messages (id, account_id, folder_id, uid, thread_id, message_id_header, refs, subject,
             from_name, from_addr, to_json, cc_json, reply_to_json, date, snippet, unread, flagged, has_attachments, bcc_json,
             category, signals, list_unsubscribe, labels)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const row of rows) insert.run(...(row as (string | number | null)[]))
      })
      for (const [id, source] of complete) await storeBody(id, account.id, source).catch(() => undefined)
      // Replay rule actions on the server while the folder is still selected.
      try {
        if (toRead.length) await client.messageFlagsAdd(toRead, ['\\Seen'], { uid: true })
        if (toStar.length) await client.messageFlagsAdd(toStar, ['\\Flagged'], { uid: true })
        for (const [path, uids] of toMove) await client.messageMove(uids, path, { uid: true })
      } catch {
        // The local state is already right; the next sync will reconcile with the server.
      }
    }

    const unseen = mailbox.exists ? ((await client.search({ seen: false }, { uid: true })) || []).length : 0
    db.prepare('UPDATE folders SET unread = ?, total = ? WHERE id = ?').run(unseen, mailbox.exists, folder.id)
    notify(account, newUnread)
  })
}

interface Incoming {
  from: string
  subject: string
  category: MailCategory
}

/** System notification for new mail, filtered by the user's notification preferences. */
function notify(account: Account, items: Incoming[]): void {
  const settings = getSettings()
  if (!account.notify || !settings.mailNotifications || inQuietHours() || !Notification.isSupported()) return
  const wanted = settings.smartNotifications ? items.filter((i) => i.category === 'people' || i.category === 'invitations') : items
  if (!wanted.length) return
  const body = wanted.length === 1 ? wanted[0].subject || '(sans objet)' : `${wanted.length} nouveaux messages`
  const title = wanted.length === 1 ? wanted[0].from : account.name
  new Notification({ title, body, silent: !settings.mailSound }).show()
}

/**
 * Downloads the bodies of the newest messages of a folder that don't have one yet, on the sync's
 * connection: one FETCH for sizes, one for the sources. Skips large mail (attachments) and caps the total.
 */
async function prefetchBodies(client: ImapFlow, account: Account, folder: FolderRow): Promise<void> {
  const missing = getDb()
    .prepare('SELECT id, uid FROM messages WHERE folder_id = ? AND eml_path IS NULL ORDER BY date DESC LIMIT ?')
    .all(folder.id, PREFETCH.count) as { id: string; uid: number }[]
  if (!missing.length) return
  await inMailbox(client, folder.path, async () => {
    const sizes = new Map<number, number>()
    for await (const msg of client.fetch(
      missing.map((m) => m.uid),
      { uid: true, size: true },
      { uid: true }
    )) {
      if (msg.size) sizes.set(msg.uid, msg.size)
    }
    let budget = PREFETCH.maxTotalBytes
    const wanted = missing.filter((m) => {
      const size = sizes.get(m.uid)
      if (!size || size > PREFETCH.maxMessageBytes || size > budget) return false
      budget -= size
      return true
    })
    if (!wanted.length) return
    const idByUid = new Map(wanted.map((m) => [m.uid, m.id]))
    const sources: [string, Buffer][] = []
    for await (const msg of client.fetch(
      wanted.map((m) => m.uid),
      { uid: true, source: true },
      { uid: true }
    )) {
      const id = idByUid.get(msg.uid)
      if (id && msg.source) sources.push([id, msg.source])
    }
    for (const [id, source] of sources) await storeBody(id, account.id, source).catch(() => undefined)
  })
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
          // One FETCH for the whole conversation: a round trip per message costs more than the bytes.
          const idByUid = new Map(inFolder.map((m) => [m.uid, m.id]))
          const sources: [string, Buffer][] = []
          for await (const msg of client.fetch(
            inFolder.map((m) => m.uid),
            { uid: true, source: true },
            { uid: true }
          )) {
            const id = idByUid.get(msg.uid)
            if (id && msg.source) sources.push([id, msg.source])
          }
          for (const [id, source] of sources) await storeBody(id, accountId, source)
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
