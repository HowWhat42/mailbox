import { randomUUID } from 'node:crypto'
import type { Address, MailTemplate, MailTemplateInput } from '@shared/types'
import { getDb } from './db'

interface TemplateRow {
  id: string
  account_id: string
  name: string
  subject: string
  html: string
  to_json: string
  cc_json: string
  updated_at: number
}

function toTemplate(r: TemplateRow): MailTemplate {
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    subject: r.subject,
    html: r.html,
    to: JSON.parse(r.to_json) as Address[],
    cc: JSON.parse(r.cc_json) as Address[],
    updatedAt: r.updated_at
  }
}

/** Templates of one account, or of all accounts; by name. */
export function listTemplates(accountId?: string): MailTemplate[] {
  const db = getDb()
  const rows = accountId
    ? db.prepare('SELECT * FROM templates WHERE account_id = ? ORDER BY name COLLATE NOCASE').all(accountId)
    : db.prepare('SELECT * FROM templates ORDER BY name COLLATE NOCASE').all()
  return (rows as unknown as TemplateRow[]).map(toTemplate)
}

export function saveTemplate(input: MailTemplateInput): MailTemplate {
  const name = input.name.trim()
  if (!name) throw new Error('Donnez un nom au modèle.')
  const id = input.id ?? randomUUID()
  getDb()
    .prepare(
      `INSERT INTO templates (id, account_id, name, subject, html, to_json, cc_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET account_id = excluded.account_id, name = excluded.name, subject = excluded.subject,
         html = excluded.html, to_json = excluded.to_json, cc_json = excluded.cc_json, updated_at = excluded.updated_at`
    )
    .run(id, input.accountId, name, input.subject, input.html, JSON.stringify(input.to), JSON.stringify(input.cc), Date.now())
  return toTemplate(getDb().prepare('SELECT * FROM templates WHERE id = ?').get(id) as unknown as TemplateRow)
}

export function removeTemplate(id: string): void {
  getDb().prepare('DELETE FROM templates WHERE id = ?').run(id)
}
