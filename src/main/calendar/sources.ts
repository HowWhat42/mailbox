import { randomUUID } from 'node:crypto'
import type { CalendarSource, CalendarSourceInput, CalendarSourceKind } from '@shared/types'
import { getDb } from '../db'
import { getSecret, listAccounts } from '../accounts/store'
import { openSecret, sealSecret } from '../accounts/secrets'
import { authorizeGoogle, googleAccessToken, googleTokenFor } from '../accounts/google'

const PALETTE = ['#8f86f0', '#6f8cff', '#f472b6', '#fbbf24', '#2dd4bf', '#a3e635', '#fb923c', '#f87171']

interface SourceRow {
  id: string
  kind: CalendarSourceKind
  name: string
  color: string
  account_id: string | null
  url: string | null
  username: string | null
  secret: Uint8Array | null
  sync_error: string | null
  last_sync_at: number | null
}

function toSource(r: SourceRow): CalendarSource {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    color: r.color,
    accountId: r.account_id,
    url: r.url,
    username: r.username,
    syncError: r.sync_error,
    lastSyncAt: r.last_sync_at
  }
}

export function listSources(): CalendarSource[] {
  return (getDb().prepare('SELECT * FROM cal_sources ORDER BY created_at').all() as unknown as SourceRow[]).map(toSource)
}

export function getSource(id: string): CalendarSource {
  const row = getDb().prepare('SELECT * FROM cal_sources WHERE id = ?').get(id) as unknown as SourceRow | undefined
  if (!row) throw new Error('Agenda introuvable.')
  return toSource(row)
}

function insertSource(s: Omit<CalendarSource, 'id' | 'color' | 'syncError' | 'lastSyncAt'>, secret: object | null): CalendarSource {
  const db = getDb()
  const count = (db.prepare('SELECT count(*) AS n FROM cal_sources').get() as { n: number }).n
  const id = randomUUID()
  db.prepare(
    `INSERT INTO cal_sources (id, kind, name, color, account_id, url, username, secret, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, s.kind, s.name, PALETTE[count % PALETTE.length], s.accountId, s.url, s.username, secret ? sealSecret(secret) : null, Date.now())
  return getSource(id)
}

/** Connects a new standalone calendar source. Credentials are checked by the first refresh. */
export async function addSource(input: CalendarSourceInput): Promise<CalendarSource> {
  if (input.kind === 'google') {
    const { email, refreshToken } = await authorizeGoogle('calendar')
    const dup = listSources().find((s) => s.kind === 'google' && s.username === email)
    if (dup) throw new Error(`Les agendas de ${email} sont déjà connectés.`)
    return insertSource({ kind: 'google', name: email, accountId: null, url: null, username: email }, { refreshToken })
  }
  const url = input.url.trim().replace(/^webcal:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(url)) throw new Error('L’adresse doit commencer par https://')
  if (input.kind === 'ics') {
    return insertSource({ kind: 'ics', name: input.name.trim() || new URL(url).hostname, accountId: null, url, username: null }, null)
  }
  return insertSource(
    { kind: 'caldav', name: input.name.trim() || input.username, accountId: null, url, username: input.username.trim() },
    { password: input.password }
  )
}

export function updateSource(id: string, patch: { name?: string; color?: string }): void {
  const db = getDb()
  if (patch.name !== undefined) db.prepare('UPDATE cal_sources SET name = ? WHERE id = ?').run(patch.name, id)
  if (patch.color !== undefined) db.prepare('UPDATE cal_sources SET color = ? WHERE id = ?').run(patch.color, id)
}

export function removeSource(id: string): void {
  getDb().prepare('DELETE FROM cal_sources WHERE id = ?').run(id)
}

export function setSourceResult(id: string, error: string | null): void {
  if (error) getDb().prepare('UPDATE cal_sources SET sync_error = ? WHERE id = ?').run(error, id)
  else getDb().prepare('UPDATE cal_sources SET sync_error = NULL, last_sync_at = ? WHERE id = ?').run(Date.now(), id)
}

/**
 * Mail accounts bring their calendars along: every Google account and every IMAP
 * account with a CalDAV URL gets a linked source, kept in step with the account.
 */
export function syncAccountSources(): void {
  const db = getDb()
  const linked = (db.prepare('SELECT * FROM cal_sources WHERE account_id IS NOT NULL').all() as unknown as SourceRow[]).map(toSource)
  for (const account of listAccounts()) {
    const existing = linked.find((s) => s.accountId === account.id)
    const wanted: CalendarSourceKind | null = account.kind === 'google' ? 'google' : account.caldavUrl ? 'caldav' : null
    if (!wanted) {
      if (existing) removeSource(existing.id)
      continue
    }
    if (!existing) {
      insertSource({ kind: wanted, name: account.name, accountId: account.id, url: account.caldavUrl, username: account.username }, null)
    } else if (existing.url !== account.caldavUrl || existing.username !== account.username) {
      db.prepare('UPDATE cal_sources SET url = ?, username = ? WHERE id = ?').run(account.caldavUrl, account.username, existing.id)
    }
  }
}

/** Basic-auth credentials of a CalDAV source (its own, or its mail account's). */
export function caldavCredentials(source: CalendarSource): { url: string; username: string; password: string } {
  if (!source.url) throw new Error('Aucune URL CalDAV pour cet agenda.')
  if (source.accountId) return { url: source.url, username: source.username ?? '', password: getSecret(source.accountId).password ?? '' }
  const row = getDb().prepare('SELECT secret FROM cal_sources WHERE id = ?').get(source.id) as { secret: Uint8Array | null }
  return { url: source.url, username: source.username ?? '', password: row.secret ? (openSecret(row.secret).password ?? '') : '' }
}

export async function googleTokenForSource(source: CalendarSource): Promise<string> {
  if (source.accountId) return googleAccessToken(source.accountId)
  return googleTokenFor(`cal:${source.id}`, () => {
    const row = getDb().prepare('SELECT secret FROM cal_sources WHERE id = ?').get(source.id) as { secret: Uint8Array | null }
    return row.secret ? openSecret(row.secret).refreshToken : undefined
  })
}
