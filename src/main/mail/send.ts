import { createTransport } from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type Mail from 'nodemailer/lib/mailer'
import type { Account, OutgoingAttachment, OutgoingMessage } from '@shared/types'
import { getDb } from '../db'
import { emit } from '../events'
import { getAccount, getSecret } from '../accounts/store'
import { googleAccessToken } from '../accounts/google'
import { inMailbox, withImap } from './imap'
import { loadAttachment } from './attachments'
import { describeError, foldersOf, syncFolder } from './sync'

async function attachmentsOf(list: OutgoingAttachment[]): Promise<Mail.Attachment[]> {
  return Promise.all(
    list.map(async (a) => {
      if (a.kind === 'file') return { path: a.path, filename: a.name }
      const { content } = await loadAttachment(a.messageId, a.attachmentId)
      return { content, filename: a.name }
    })
  )
}

async function buildMime(account: Account, msg: OutgoingMessage, { requireRecipients }: { requireRecipients: boolean }) {
  const mail = new MailComposer({
    from: { name: account.name, address: account.email },
    to: msg.to || undefined,
    cc: msg.cc || undefined,
    bcc: msg.bcc || undefined,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    inReplyTo: msg.inReplyTo ? `<${msg.inReplyTo}>` : undefined,
    references: msg.references.length ? msg.references.map((r) => `<${r}>`).join(' ') : undefined,
    attachments: await attachmentsOf(msg.attachments)
  }).compile()
  // Drafts keep Bcc so it survives reopening; sent mail must not leak it.
  mail.keepBcc = !requireRecipients
  const envelope = mail.getEnvelope()
  if (requireRecipients && !envelope.to.length) throw new Error('Aucun destinataire valide.')
  return { raw: await mail.build(), envelope, messageId: mail.messageId().replace(/^<|>$/g, '') }
}

export async function sendMessage(msg: OutgoingMessage): Promise<void> {
  const account = getAccount(msg.accountId)
  const { raw, envelope } = await buildMime(account, msg, { requireRecipients: true })

  const transport = createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth:
      account.kind === 'google'
        ? { type: 'OAuth2', user: account.email, accessToken: await googleAccessToken(account.id) }
        : { user: account.username, pass: getSecret(account.id).password ?? '' }
  })
  try {
    await transport.sendMail({ envelope, raw })
  } catch (err) {
    throw new Error(`Envoi impossible : ${describeError(err)}`, { cause: err })
  } finally {
    transport.close()
  }

  if (msg.draftId) await deleteDraft(msg.draftId).catch(() => {})

  // Gmail files sent mail itself; other servers need an explicit copy in Sent.
  const sent = foldersOf(account.id).find((f) => f.role === 'sent')
  if (!sent) return
  await withImap(account, async (client) => {
    if (account.kind !== 'google') await client.append(sent.path, raw, ['\\Seen'])
    await syncFolder(client, account, sent)
  }).catch(() => {
    // The message is sent; failing to file a copy must not report a send failure.
  })
  emit('mail:changed', { accountId: account.id })
}

/**
 * Stores the draft in the account's Drafts folder, replacing the previous version.
 * Attachments are re-pointed at the new draft so the next save still finds them.
 */
export async function saveDraft(msg: OutgoingMessage): Promise<{ id: string; attachments: OutgoingAttachment[] } | null> {
  const account = getAccount(msg.accountId)
  const drafts = foldersOf(account.id).find((f) => f.role === 'drafts')
  if (!drafts) return null
  const { raw, messageId } = await buildMime(account, msg, { requireRecipients: false })

  await withImap(account, async (client) => {
    await client.append(drafts.path, raw, ['\\Draft', '\\Seen'])
    await syncFolder(client, account, drafts)
  })
  if (msg.draftId) await deleteDraft(msg.draftId).catch(() => {})

  const row = getDb()
    .prepare('SELECT id FROM messages WHERE folder_id = ? AND message_id_header = ? ORDER BY uid DESC LIMIT 1')
    .get(drafts.id, messageId) as { id: string } | undefined
  emit('mail:changed', { accountId: account.id })
  if (!row) return null
  return {
    id: row.id,
    attachments: msg.attachments.map((a, i) => ({ kind: 'message', messageId: row.id, attachmentId: String(i), name: a.name, size: a.size }))
  }
}

export async function deleteDraft(messageId: string): Promise<void> {
  const row = getDb()
    .prepare('SELECT m.uid, m.account_id, f.path FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.id = ?')
    .get(messageId) as { uid: number; account_id: string; path: string } | undefined
  if (!row) return
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(messageId)
  emit('mail:changed', { accountId: row.account_id })
  await withImap(getAccount(row.account_id), (client) =>
    inMailbox(client, row.path, async () => {
      await client.messageDelete([row.uid], { uid: true })
    })
  )
}
