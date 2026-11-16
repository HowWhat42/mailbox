import { randomUUID } from 'node:crypto'
import type { MailCategory, MailRule } from '@shared/types'
import { getDb, tx } from '../db'
import { emit } from '../events'
import { classify, type Signals } from './triage'

const LABEL: Record<MailCategory, string> = { people: 'Personnes', notifications: 'Notifications', newsletters: 'Newsletters', invitations: 'Invitations' }

export function listRules(): MailRule[] {
  return (getDb().prepare('SELECT data FROM rules ORDER BY position').all() as { data: string }[]).map((r) => JSON.parse(r.data))
}

export function saveRule(rule: MailRule): MailRule {
  const db = getDb()
  const clean: MailRule = {
    ...rule,
    id: rule.id || randomUUID(),
    name: rule.name.trim() || 'Règle sans nom',
    conditions: rule.conditions.filter((c) => c.value.trim()),
    // A target folder is tied to one account.
    actions: rule.accountId ? rule.actions : { ...rule.actions, moveTo: undefined }
  }
  const exists = db.prepare('SELECT 1 FROM rules WHERE id = ?').get(clean.id)
  if (exists) db.prepare('UPDATE rules SET data = ? WHERE id = ?').run(JSON.stringify(clean), clean.id)
  else {
    const next = (db.prepare('SELECT coalesce(max(position), -1) + 1 AS p FROM rules').get() as { p: number }).p
    db.prepare('INSERT INTO rules (id, position, data) VALUES (?, ?, ?)').run(clean.id, next, JSON.stringify(clean))
  }
  return clean
}

export function removeRule(id: string): void {
  getDb().prepare('DELETE FROM rules WHERE id = ?').run(id)
}

export function reorderRules(ids: string[]): void {
  tx(() => ids.forEach((id, i) => getDb().prepare('UPDATE rules SET position = ? WHERE id = ?').run(i, id)))
}

/** Addresses this account has written to: their mail lands in People. */
export function knownContacts(accountId: string): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT lower(json_extract(j.value, '$.address')) AS a
       FROM messages m JOIN folders f ON f.id = m.folder_id, json_each(m.to_json) j
       WHERE m.account_id = ? AND f.role = 'sent'
       UNION
       SELECT lower(json_extract(j.value, '$.address'))
       FROM messages m JOIN folders f ON f.id = m.folder_id, json_each(m.cc_json) j
       WHERE m.account_id = ? AND f.role = 'sent'`
    )
    .all(accountId, accountId) as { a: string | null }[]
  return new Set(rows.map((r) => r.a).filter((a): a is string => !!a))
}

/** Re-sorts every local message with the current rules (categories only). */
export function reapplyRules(): number {
  const db = getDb()
  const rules = listRules()
  const contacts = new Map<string, Set<string>>()
  const rows = db.prepare('SELECT id, account_id, from_addr, from_name, to_json, subject, signals, category FROM messages').all() as {
    id: string
    account_id: string
    from_addr: string
    from_name: string
    to_json: string
    subject: string
    signals: string
    category: MailCategory
  }[]
  let changed = 0
  tx(() => {
    const update = db.prepare('UPDATE messages SET category = ? WHERE id = ?')
    for (const r of rows) {
      if (!contacts.has(r.account_id)) contacts.set(r.account_id, knownContacts(r.account_id))
      const { category } = classify(
        {
          fromAddr: r.from_addr,
          fromName: r.from_name,
          to: (JSON.parse(r.to_json) as { address: string }[]).map((a) => a.address),
          subject: r.subject,
          signals: JSON.parse(r.signals) as Signals
        },
        rules,
        r.account_id,
        contacts.get(r.account_id)!
      )
      if (category !== r.category) {
        update.run(category, r.id)
        changed++
      }
    }
  })
  emit('mail:changed', { accountId: '' })
  return changed
}

/** "Always sort mail from this sender into…": updates the sender's rule or creates one. */
export function classifySender(address: string, category: MailCategory): void {
  const addr = address.trim().toLowerCase()
  const existing = listRules().find((r) => r.conditions.length === 1 && r.conditions[0].field === 'from' && r.conditions[0].op === 'is' && r.conditions[0].value.toLowerCase() === addr)
  saveRule(
    existing
      ? { ...existing, enabled: true, actions: { ...existing.actions, category }, name: `${addr} → ${LABEL[category]}` }
      : { id: '', name: `${addr} → ${LABEL[category]}`, enabled: true, accountId: null, conditions: [{ field: 'from', op: 'is', value: addr }], actions: { category } }
  )
  reapplyRules()
}
