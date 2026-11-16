import { shell } from 'electron'
import { getDb } from '../db'
import { sendMessage } from './send'
import type { Signals } from './triage'

/**
 * Unsubscribes using the sender's List-Unsubscribe header:
 * one-click POST (RFC 8058) when offered, otherwise a mailto request, otherwise the web page.
 */
export async function unsubscribe(messageId: string): Promise<'done' | 'opened'> {
  const row = getDb().prepare('SELECT account_id, list_unsubscribe, signals FROM messages WHERE id = ?').get(messageId) as
    | { account_id: string; list_unsubscribe: string | null; signals: string }
    | undefined
  if (!row?.list_unsubscribe) throw new Error('Cet expéditeur ne propose pas de désabonnement automatique.')
  const targets = [...row.list_unsubscribe.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim())
  const web = targets.find((t) => /^https:\/\//i.test(t))
  const mail = targets.find((t) => /^mailto:/i.test(t))
  const signals = JSON.parse(row.signals) as Signals

  if (web && signals.oneClickUnsubscribe) {
    const res = await fetch(web, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      signal: AbortSignal.timeout(15_000)
    })
    if (res.ok) return 'done'
  }
  if (mail) {
    const url = new URL(mail)
    await sendMessage({
      accountId: row.account_id,
      to: decodeURIComponent(url.pathname),
      cc: '',
      bcc: '',
      subject: url.searchParams.get('subject') ?? 'unsubscribe',
      html: '',
      text: url.searchParams.get('body') ?? 'unsubscribe',
      inReplyTo: null,
      references: [],
      attachments: [],
      draftId: null
    })
    return 'done'
  }
  if (web) {
    await shell.openExternal(web)
    return 'opened'
  }
  throw new Error('Lien de désabonnement inutilisable.')
}
