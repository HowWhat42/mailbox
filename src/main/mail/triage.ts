import type { MessageStructureObject } from 'imapflow'
import type { MailCategory, MailRule, RuleActions, RuleCondition } from '@shared/types'

/** Headers fetched at sync time to sort mail (besides References for threading). */
export const TRIAGE_HEADERS = [
  'references',
  'list-unsubscribe',
  'list-unsubscribe-post',
  'list-id',
  'precedence',
  'auto-submitted',
  'x-auto-response-suppress',
  'feedback-id',
  'x-campaign',
  'x-campaign-id',
  'x-mailchimp-campaign',
  'x-mc-user',
  'x-sg-eid',
  'x-mailgun-tag',
  'x-ses-outgoing'
]

/** Raw facts about a message, stored so categories can be recomputed when rules change. */
export interface Signals {
  listUnsubscribe?: boolean
  oneClickUnsubscribe?: boolean
  listId?: boolean
  bulk?: boolean
  autoSubmitted?: boolean
  esp?: boolean
  invite?: boolean
}

/** Parses a raw header block (folded lines) into lower-cased name → value. */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of (raw ?? '').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return out
}

function hasCalendarPart(node: MessageStructureObject | undefined): boolean {
  if (!node) return false
  if (/^(text\/calendar|application\/ics)$/i.test(node.type ?? '')) return true
  return node.childNodes?.some(hasCalendarPart) ?? false
}

export function signalsFrom(headers: Record<string, string>, structure: MessageStructureObject | undefined, subject: string): Signals {
  const precedence = (headers['precedence'] ?? '').toLowerCase()
  const auto = (headers['auto-submitted'] ?? 'no').toLowerCase()
  return {
    listUnsubscribe: !!headers['list-unsubscribe'],
    oneClickUnsubscribe: /one-click/i.test(headers['list-unsubscribe-post'] ?? ''),
    listId: !!headers['list-id'],
    bulk: ['bulk', 'list', 'junk'].includes(precedence),
    autoSubmitted: auto !== 'no' || !!headers['x-auto-response-suppress'],
    esp: ['feedback-id', 'x-campaign', 'x-campaign-id', 'x-mailchimp-campaign', 'x-mc-user', 'x-sg-eid', 'x-mailgun-tag', 'x-ses-outgoing'].some((h) => h in headers),
    invite: hasCalendarPart(structure) || /^(invitation|invitation mise à jour|updated invitation|accepted|accepté|declined|refusé)\s*:/i.test(subject)
  }
}

const AUTOMATED = /^(no-?reply|do-?not-?reply|ne-?pas-?repondre|nepasrepondre|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|automated|security|billing|invoices?|factures?|receipts?|orders?|commandes?|account|accounts|system|support|calendar-notification)\b/i
const MARKETING = /^(news|newsletters?|hello|info|marketing|updates?|digest|team|contact|offers?|promo)\b/i

export interface Classifiable {
  fromAddr: string
  fromName: string
  to: string[]
  subject: string
  signals: Signals
}

function field(m: Classifiable, f: RuleCondition['field']): string[] {
  if (f === 'from') return [m.fromAddr, m.fromName]
  if (f === 'domain') return [m.fromAddr.split('@')[1] ?? '']
  if (f === 'to') return m.to
  return [m.subject]
}

export function matches(m: Classifiable, c: RuleCondition): boolean {
  const needle = c.value.trim().toLowerCase()
  if (!needle) return false
  return field(m, c.field).some((v) => {
    const hay = v.toLowerCase()
    if (c.op === 'contains') return hay.includes(needle)
    return c.field === 'domain' ? hay === needle || hay.endsWith(`.${needle}`) : hay === needle
  })
}

/** Category from heuristics alone (no user rules). */
export function heuristicCategory(m: Classifiable, knownContacts: Set<string>): MailCategory {
  const s = m.signals
  if (s.invite) return 'invitations'
  const local = m.fromAddr.split('@')[0] ?? ''
  const mass = s.listUnsubscribe || s.listId || s.bulk || s.esp
  // Someone you've written to is a person, unless the message is clearly a mass mailing.
  if (knownContacts.has(m.fromAddr.toLowerCase()) && !mass) return 'people'
  if (s.autoSubmitted || AUTOMATED.test(local)) return 'notifications'
  if (mass) return MARKETING.test(local) || s.esp || s.bulk ? 'newsletters' : 'notifications'
  if (MARKETING.test(local)) return 'newsletters'
  return 'people'
}

/** Applies user rules in order on top of the heuristics. */
export function classify(m: Classifiable, rules: MailRule[], accountId: string, knownContacts: Set<string>): { category: MailCategory; actions: RuleActions } {
  const actions: RuleActions = {}
  let category: MailCategory | undefined
  for (const rule of rules) {
    if (!rule.enabled || (rule.accountId && rule.accountId !== accountId) || !rule.conditions.length) continue
    if (!rule.conditions.every((c) => matches(m, c))) continue
    category ??= rule.actions.category
    actions.markRead ||= rule.actions.markRead
    actions.star ||= rule.actions.star
    actions.mute ||= rule.actions.mute
    // A folder only makes sense on its own account.
    if (rule.accountId === accountId) actions.moveTo ??= rule.actions.moveTo
  }
  return { category: category ?? heuristicCategory(m, knownContacts), actions }
}
