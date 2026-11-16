import type { MessageDetail, ThreadSummary } from '@shared/types'
import { api, useStore, type ComposeDraft } from '../store'
import { displayName, escapeHtml, formatAddresses, fullDate, textToHtml } from './format'

export type ReplyKind = 'reply' | 'replyAll' | 'forward'

function prefixed(subject: string, prefix: 'Re' | 'Fwd'): string {
  const re = prefix === 'Re' ? /^(re|ré|aw|sv)\s*:/i : /^(fwd?|tr)\s*:/i
  return re.test(subject.trim()) ? subject : `${prefix}: ${subject}`
}

/** Builds a composer draft answering the last message of a thread. */
export async function replyDraft(thread: ThreadSummary, kind: ReplyKind, message?: MessageDetail): Promise<Partial<ComposeDraft>> {
  const msg = message ?? (await api.mail.thread(thread.accountId, thread.threadId)).at(-1)
  if (!msg) return { accountId: thread.accountId }
  const me = useStore.getState().accounts.find((a) => a.id === thread.accountId)?.email.toLowerCase()
  const body = msg.html ?? (msg.text ? textToHtml(msg.text) : '')
  const header = `Le ${fullDate(msg.date)}, ${escapeHtml(displayName(msg.from))} a écrit :`

  if (kind === 'forward') {
    return {
      accountId: thread.accountId,
      subject: prefixed(msg.subject, 'Fwd'),
      html:
        `<p><br></p><p>---------- Message transféré ----------<br>` +
        `De : ${escapeHtml(formatAddresses([msg.from]))}<br>Date : ${fullDate(msg.date)}<br>` +
        `Objet : ${escapeHtml(msg.subject)}<br>À : ${escapeHtml(formatAddresses(msg.to))}</p>${body}`
    }
  }

  const fromMe = msg.from.address.toLowerCase() === me
  const primary = fromMe ? msg.to : msg.replyTo.length ? msg.replyTo : [msg.from]
  const others =
    kind === 'replyAll'
      ? [...msg.to, ...msg.cc].filter(
          (a) => a.address.toLowerCase() !== me && !primary.some((p) => p.address.toLowerCase() === a.address.toLowerCase())
        )
      : []

  return {
    accountId: thread.accountId,
    to: formatAddresses(primary),
    cc: formatAddresses(others),
    subject: prefixed(msg.subject, 'Re'),
    inReplyTo: msg.messageIdHeader,
    references: [...msg.references, ...(msg.messageIdHeader ? [msg.messageIdHeader] : [])],
    html: `<p><br></p><p>${header}</p><blockquote>${body}</blockquote>`
  }
}
