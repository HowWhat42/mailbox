import { randomUUID } from 'node:crypto'
import type { Account, AccountKind } from '@shared/types'
import { getDb } from '../db'
import { openSecret, sealSecret, type AccountSecret } from './secrets'

const PALETTE = ['#2dd4bf', '#818cf8', '#f472b6', '#fbbf24', '#60a5fa', '#a3e635', '#fb923c']

interface AccountRow {
  id: string
  kind: AccountKind
  name: string
  email: string
  color: string
  imap_host: string
  imap_port: number
  imap_secure: number
  smtp_host: string
  smtp_port: number
  smtp_secure: number
  username: string
  secret: Uint8Array
  caldav_url: string | null
  signature: string
  last_sync_at: number | null
  sync_error: string | null
  label: string
  notify: number
  in_unified: number
  sync_depth: number
}

function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    email: r.email,
    color: r.color,
    imapHost: r.imap_host,
    imapPort: r.imap_port,
    imapSecure: !!r.imap_secure,
    smtpHost: r.smtp_host,
    smtpPort: r.smtp_port,
    smtpSecure: !!r.smtp_secure,
    username: r.username,
    caldavUrl: r.caldav_url,
    signature: r.signature,
    lastSyncAt: r.last_sync_at,
    syncError: r.sync_error,
    label: r.label,
    notify: !!r.notify,
    inUnified: !!r.in_unified,
    syncDepth: r.sync_depth
  }
}

export function listAccounts(): Account[] {
  const rows = getDb().prepare('SELECT * FROM accounts ORDER BY created_at').all() as unknown as AccountRow[]
  return rows.map(toAccount)
}

export function getAccount(id: string): Account {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as AccountRow | undefined
  if (!row) throw new Error(`Compte introuvable : ${id}`)
  return toAccount(row)
}

export function getSecret(id: string): AccountSecret {
  const row = getDb().prepare('SELECT secret FROM accounts WHERE id = ?').get(id) as { secret: Uint8Array } | undefined
  if (!row) throw new Error(`Compte introuvable : ${id}`)
  return openSecret(row.secret)
}

export function setSecret(id: string, secret: AccountSecret): void {
  getDb().prepare('UPDATE accounts SET secret = ? WHERE id = ?').run(sealSecret(secret), id)
}

export type NewAccount = Omit<Account, 'id' | 'color' | 'signature' | 'lastSyncAt' | 'syncError' | 'label' | 'notify' | 'inUnified' | 'syncDepth'>

export function insertAccount(input: NewAccount, secret: AccountSecret): Account {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM accounts WHERE email = ? AND kind = ?').get(input.email, input.kind) as { id: string } | undefined
  if (existing) throw new Error(`Le compte ${input.email} est déjà configuré.`)
  const count = (db.prepare('SELECT count(*) AS n FROM accounts').get() as { n: number }).n
  const id = randomUUID()
  db.prepare(
    `INSERT INTO accounts (id, kind, name, email, color, imap_host, imap_port, imap_secure, smtp_host, smtp_port,
      smtp_secure, username, secret, caldav_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.kind,
    input.name,
    input.email,
    PALETTE[count % PALETTE.length],
    input.imapHost,
    input.imapPort,
    input.imapSecure ? 1 : 0,
    input.smtpHost,
    input.smtpPort,
    input.smtpSecure ? 1 : 0,
    input.username,
    sealSecret(secret),
    input.caldavUrl,
    Date.now()
  )
  return getAccount(id)
}

export function updateAccount(
  id: string,
  patch: Partial<Pick<Account, 'name' | 'label' | 'color' | 'signature' | 'caldavUrl' | 'notify' | 'inUnified' | 'syncDepth'>>
): void {
  const cols: Record<string, string> = {
    name: 'name',
    label: 'label',
    color: 'color',
    signature: 'signature',
    caldavUrl: 'caldav_url',
    notify: 'notify',
    inUnified: 'in_unified',
    syncDepth: 'sync_depth'
  }
  const sets: string[] = []
  const values: (string | number | null)[] = []
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in cols) || value === undefined) continue
    sets.push(`${cols[key]} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null))
  }
  if (!sets.length) return
  getDb()
    .prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, id)
}

export function setSyncResult(id: string, error: string | null): void {
  if (error) getDb().prepare('UPDATE accounts SET sync_error = ? WHERE id = ?').run(error, id)
  else getDb().prepare('UPDATE accounts SET last_sync_at = ?, sync_error = NULL WHERE id = ?').run(Date.now(), id)
}

export function deleteAccount(id: string): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
