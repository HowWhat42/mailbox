import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { McpActivity } from '@shared/types'
import { getDb } from '../db'
import { emit } from '../events'
import { openString, sealString } from '../accounts/secrets'

const TOKEN_KEY = 'mcp:token'
const LOG_KEEP = 500

const store = (sealed: Buffer): void => {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(TOKEN_KEY, JSON.stringify(sealed.toString('base64')))
}

/** Read (or first created) once, then kept in memory; concurrent first calls share it. */
let current: Promise<string> | null = null

/** The bearer token, sealed with the OS keychain (DPAPI / Keychain) in the settings table. */
export function getToken(): Promise<string> {
  current ??= (async () => {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(TOKEN_KEY) as { value: string } | undefined
    if (!row) return createToken()
    return openString(Buffer.from(JSON.parse(row.value) as string, 'base64'), store)
  })()
  // A failure (keychain unavailable) is retried on the next call rather than remembered.
  current.catch(() => (current = null))
  return current
}

async function createToken(): Promise<string> {
  const token = `mbx_${randomBytes(32).toString('base64url')}`
  store(await sealString(token))
  return token
}

export function regenerateToken(): Promise<string> {
  current = createToken()
  current.catch(() => (current = null))
  return current
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest()

/** Constant-time comparison of the presented bearer token with the stored one. */
export async function tokenMatches(presented: string): Promise<boolean> {
  return timingSafeEqual(digest(presented), digest(await getToken()))
}

/**
 * Failed logins lock the server for a minute after a few tries, so the token can't be guessed;
 * accepted requests are capped per minute so a runaway assistant can't hammer the mail servers.
 */
const WINDOW = 60_000
const MAX_FAILURES = 5
const MAX_REQUESTS = 120
let failures: number[] = []
let lockedUntil = 0
let requests: number[] = []

export function isLocked(now = Date.now()): boolean {
  return now < lockedUntil
}

export function recordFailure(now = Date.now()): void {
  failures = [...failures.filter((t) => now - t < WINDOW), now]
  if (failures.length >= MAX_FAILURES) {
    lockedUntil = now + WINDOW
    failures = []
  }
}

export function allowRequest(now = Date.now()): boolean {
  requests = requests.filter((t) => now - t < WINDOW)
  if (requests.length >= MAX_REQUESTS) return false
  requests.push(now)
  return true
}

export function resetLimits(): void {
  failures = []
  lockedUntil = 0
  requests = []
}

export function logActivity(tool: string, outcome: McpActivity['outcome'], detail: string): void {
  const db = getDb()
  db.prepare('INSERT INTO mcp_log (at, tool, outcome, detail) VALUES (?, ?, ?, ?)').run(Date.now(), tool, outcome, detail.slice(0, 300))
  db.prepare('DELETE FROM mcp_log WHERE id <= (SELECT max(id) FROM mcp_log) - ?').run(LOG_KEEP)
  emit('mcp:changed', {})
}

export function listActivity(limit: number): McpActivity[] {
  return getDb()
    .prepare('SELECT id, at, tool, outcome, detail FROM mcp_log ORDER BY id DESC LIMIT ?')
    .all(Math.max(1, Math.min(LOG_KEEP, Math.floor(limit)))) as unknown as McpActivity[]
}

export function clearActivity(): void {
  getDb().prepare('DELETE FROM mcp_log').run()
  emit('mcp:changed', {})
}
