import type { Address, MessageDetail, ThreadSummary } from '@shared/types'
import { api, useStore, type ComposeDraft } from '../store'
import { displayName, escapeHtml, formatAddresses, fullDate, textToHtml } from './format'

export type ReplyKind = 'reply' | 'replyAll' | 'forward'

function prefixed(subject: string, prefix: 'Re' | 'Fwd'): string {
  const re = prefix === 'Re' ? /^(re|ré|aw|sv)\s*:/i : /^(fwd?|tr)\s*:/i
  return re.test(subject.trim()) ? subject : `${prefix}: ${subject}`
}

const same = (a: Address, b: Address): boolean => a.address.toLowerCase() === b.address.toLowerCase()

/** Builds a composer draft answering (or forwarding) the last message of a thread. */
export async function replyDraft(thread: ThreadSummary, kind: ReplyKind, message?: MessageDetail): Promise<Partial<ComposeDraft>> {
  const msg = message ?? (await api.mail.thread(thread.accountId, thread.threadId)).at(-1)
  if (!msg) return { accountId: thread.accountId, kind }
  const me = useStore
    .getState()
    .accounts.find((a) => a.id === thread.accountId)
    ?.email.toLowerCase()
  const body = msg.html ?? (msg.text ? textToHtml(msg.text) : '')

  if (kind === 'forward') {
    return {
      kind,
      accountId: thread.accountId,
      subject: prefixed(msg.subject, 'Fwd'),
      attachments: msg.attachments.map((a) => ({ kind: 'message', messageId: msg.id, attachmentId: a.id, name: a.filename, size: a.size })),
      html:
        `<p><br></p><div data-mailbox-quote=""><p>---------- Message transféré ----------<br>` +
        `De : ${escapeHtml(formatAddresses([msg.from]))}<br>Date : ${fullDate(msg.date)}<br>` +
        `Objet : ${escapeHtml(msg.subject)}<br>À : ${escapeHtml(formatAddresses(msg.to))}</p>${body}</div>`
    }
  }

  const fromMe = msg.from.address.toLowerCase() === me
  const primary = fromMe ? msg.to : msg.replyTo.length ? msg.replyTo : [msg.from]
  const others = kind === 'replyAll' ? [...msg.to, ...msg.cc].filter((a) => a.address.toLowerCase() !== me && !primary.some((p) => same(p, a))) : []

  return {
    kind,
    accountId: thread.accountId,
    to: primary,
    cc: others,
    subject: prefixed(msg.subject, 'Re'),
    inReplyTo: msg.messageIdHeader,
    references: [...msg.references, ...(msg.messageIdHeader ? [msg.messageIdHeader] : [])],
    // The quoted history is marked: the composer writes above it, and Mailbox folds it when reading.
    html: `<p><br></p><div data-mailbox-quote=""><p>Le ${fullDate(msg.date)}, ${escapeHtml(displayName(msg.from))} a écrit :</p><blockquote>${body}</blockquote></div>`
  }
}

/** Reopens a saved draft in the composer, attachments included. */
export function draftToCompose(msg: MessageDetail): Partial<ComposeDraft> {
  return {
    kind: 'draft',
    accountId: msg.accountId,
    to: msg.to,
    cc: msg.cc,
    bcc: msg.bcc,
    subject: msg.subject,
    html: msg.html ?? (msg.text ? textToHtml(msg.text) : ''),
    inReplyTo: msg.references.at(-1) ?? null,
    references: msg.references,
    attachments: msg.attachments.map((a) => ({ kind: 'message', messageId: msg.id, attachmentId: a.id, name: a.filename, size: a.size })),
    draftId: msg.id
  }
}
