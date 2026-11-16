import { getDb, tx } from '../db'
import { emit } from '../events'
import { getAccount } from '../accounts/store'
import { inMailbox, withImap } from './imap'
import { describeError } from './sync'
import { isOffline } from './queue'

/** Thunderbird's tags, so labels picked by those names stay compatible with it. */
const THUNDERBIRD_KEYWORD: Record<string, string> = {
  important: '$label1',
  travail: '$label2',
  personnel: '$label3',
  'à faire': '$label4',
  'plus tard': '$label5'
}

/** IMAP keywords are atoms: no spaces or special characters. */
function keywordFor(label: string): string {
  return (
    THUNDERBIRD_KEYWORD[label.toLowerCase()] ??
    label
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[(){}%*"\\\]]/g, '')
  )
}

function isGmail(accountId: string): boolean {
  const a = getAccount(accountId)
  return a.kind === 'google' || /(^|\.)gmail\.com$|googlemail\.com$/i.test(a.imapHost)
}

/** Labels to offer for an account: those already on its mail, plus Gmail's own label folders. */
export function knownLabels(accountId: string): string[] {
  const db = getDb()
  const used = (
    db.prepare(`SELECT DISTINCT j.value AS label FROM messages m, json_each(m.labels) j WHERE m.account_id = ?`).all(accountId) as { label: string }[]
  ).map((r) => r.label)
  const folders = isGmail(accountId)
    ? (db.prepare(`SELECT path FROM folders WHERE account_id = ? AND role IS NULL`).all(accountId) as { path: string }[]).map((r) => r.path)
    : []
  return [...new Set([...folders, ...used])].toSorted((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
}

/**
 * Adds and removes labels on every message of a conversation: Gmail labels (X-GM-LABELS, created
 * on the fly) on Gmail, keywords elsewhere. Shown at once; put back if the server refuses.
 */
export async function setThreadLabels(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  const db = getDb()
  const rows = db
    .prepare(`SELECT m.id, m.uid, m.labels, f.path FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.account_id = ? AND m.thread_id = ?`)
    .all(accountId, threadId) as { id: string; uid: number; labels: string; path: string }[]
  if (!rows.length || (!add.length && !remove.length)) return
  const update = db.prepare('UPDATE messages SET labels = ? WHERE id = ?')
  const apply = (labelsOf: (r: (typeof rows)[number]) => string): void => {
    tx(() => {
      for (const r of rows) update.run(labelsOf(r), r.id)
    })
    emit('mail:changed', { accountId })
  }
  const drop = new Set(remove.map((l) => l.toLowerCase()))
  apply((r) => {
    const next = (JSON.parse(r.labels) as string[]).filter((l) => !drop.has(l.toLowerCase()))
    for (const l of add) if (!next.some((x) => x.toLowerCase() === l.toLowerCase())) next.push(l)
    return JSON.stringify(next)
  })

  try {
    await withImap(getAccount(accountId), async (client) => {
      const gmail = client.capabilities.has('X-GM-EXT-1')
      const names = (list: string[]): string[] => (gmail ? list : list.map(keywordFor))
      for (const [path, inFolder] of Map.groupBy(rows, (r) => r.path)) {
        await inMailbox(client, path, async () => {
          const uids = inFolder.map((r) => r.uid)
          if (add.length) await client.messageFlagsAdd(uids, names(add), { uid: true, useLabels: gmail })
          if (remove.length) await client.messageFlagsRemove(uids, names(remove), { uid: true, useLabels: gmail })
        })
        // One copy is enough on Gmail: labels belong to the message, not to the folder it was seen in.
        if (gmail) break
      }
    })
  } catch (err) {
    apply((r) => r.labels)
    if (isOffline(err)) throw new Error('Hors ligne : les libellés n’ont pas pu être modifiés.', { cause: err })
    throw new Error(describeError(err), { cause: err })
  }
}
