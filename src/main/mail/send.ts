import { randomBytes } from 'node:crypto'
import type { ImapFlow } from 'imapflow'
import { createTransport } from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type Mail from 'nodemailer/lib/mailer'
import type { Account, OutgoingAttachment, OutgoingMessage } from '@shared/types'
import { getDb } from '../db'
import { emit } from '../events'
import { getAccount, getSecret } from '../accounts/store'
import { googleAccessToken } from '../accounts/google'
import { microsoftAccessToken } from '../accounts/microsoft'
import { inMailbox, withImap } from './imap'
import { loadAttachment } from './attachments'
import { describeError, foldersOf, syncFolder } from './sync'
import { enqueue, isOffline } from './queue'

async function attachmentsOf(list: OutgoingAttachment[]): Promise<Mail.Attachment[]> {
  return Promise.all(
    list.map(async (a) => {
      if (a.kind === 'file') return { path: a.path, filename: a.name }
      const { content } = await loadAttachment(a.messageId, a.attachmentId)
      return { content, filename: a.name }
    })
  )
}

const DATA_IMAGE = /(<img\b[^<>]{0,1024}?\ssrc\s*=\s*["']?)data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)/gi

/**
 * Turns `data:` images (pasted signatures, quoted inline images) into cid: parts. Base64 inside
 * the HTML part is bloated further by quoted-printable, and Gmail/Outlook often refuse to show it.
 */
export function embedDataImages(html: string): { html: string; attachments: Mail.Attachment[] } {
  const attachments: Mail.Attachment[] = []
  const out = html.replace(DATA_IMAGE, (_match, prefix: string, contentType: string, data: string) => {
    const cid = `${randomBytes(10).toString('hex')}@mailbox`
    const ext = contentType.split('/')[1]?.replace(/\+.*$/, '') || 'bin'
    attachments.push({ cid, contentType, content: Buffer.from(data, 'base64'), filename: `image-${attachments.length + 1}.${ext}` })
    return `${prefix}cid:${cid}`
  })
  return { html: out, attachments }
}

async function buildMime(account: Account, msg: OutgoingMessage, { requireRecipients }: { requireRecipients: boolean }) {
  // Drafts keep their data: images: their attachment indexes must match the user's own files.
  const inline = requireRecipients ? embedDataImages(msg.html) : { html: msg.html, attachments: [] }
  const mail = new MailComposer({
    from: { name: account.name, address: account.email },
    to: msg.to || undefined,
    cc: msg.cc || undefined,
    bcc: msg.bcc || undefined,
    subject: msg.subject,
    html: inline.html,
    text: msg.text,
    inReplyTo: msg.inReplyTo ? `<${msg.inReplyTo}>` : undefined,
    references: msg.references.length ? msg.references.map((r) => `<${r}>`).join(' ') : undefined,
    attachments: [...(await attachmentsOf(msg.attachments)), ...inline.attachments]
  }).compile()
  // Drafts keep Bcc so it survives reopening; sent mail must not leak it.
  mail.keepBcc = !requireRecipients
  const envelope = mail.getEnvelope()
  if (requireRecipients && !envelope.to.length) throw new Error('Aucun destinataire valide.')
  return { raw: await mail.build(), envelope, messageId: mail.messageId().replace(/^<|>$/g, '') }
}

/** Sends now, or puts the message in the outbox when the server can't be reached. */
export async function sendOrQueue(msg: OutgoingMessage): Promise<'sent' | 'queued'> {
  try {
    await sendMessage(msg)
    return 'sent'
  } catch (err) {
    if (!isOffline(err)) throw err
    enqueue(msg.accountId, { kind: 'send', message: msg })
    return 'queued'
  }
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
        : account.kind === 'microsoft'
          ? { type: 'OAuth2', user: account.email, accessToken: await microsoftAccessToken(account.id) }
          : { user: account.username, pass: (await getSecret(account.id)).password ?? '' }
  })
  try {
    await transport.sendMail({ envelope, raw })
  } catch (err) {
    if (isOffline(err)) throw err
    throw new Error(`Envoi impossible : ${describeError(err)}`, { cause: err })
  } finally {
    transport.close()
  }

  // The message is gone: the rest is bookkeeping, done in the background so the composer closes now.
  void fileSent(account, raw, msg.draftId)
}

/** Drops the draft and files a copy in Sent over one connection. Failures here are not send failures. */
async function fileSent(account: Account, raw: Buffer, draftId: string | null | undefined): Promise<void> {
  const draft = draftId ? forgetDraft(draftId) : null
  const sent = foldersOf(account.id).find((f) => f.role === 'sent')
  if (!draft && !sent) return
  await withImap(account, async (client) => {
    if (draft) await removeOnServer(client, draft).catch(() => {})
    if (!sent) return
    // Gmail files sent mail itself; other servers need an explicit copy in Sent.
    if (account.kind !== 'google') await client.append(sent.path, raw, ['\\Seen'])
    await syncFolder(client, account, sent)
  }).catch(() => {})
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

  // One connection stores the new version and removes the previous one.
  await withImap(account, async (client) => {
    await client.append(drafts.path, raw, ['\\Draft', '\\Seen'])
    // Only once the new version is stored: a failed save must still know the previous one.
    const previous = msg.draftId ? forgetDraft(msg.draftId) : null
    if (previous) await removeOnServer(client, previous).catch(() => {})
    await syncFolder(client, account, drafts)
  })

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

interface DraftLocation {
  uid: number
  accountId: string
  path: string
}

/** Removes the draft from the local database right away and says where it lives on the server. */
function forgetDraft(messageId: string): DraftLocation | null {
  const row = getDb()
    .prepare('SELECT m.uid, m.account_id, f.path FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.id = ?')
    .get(messageId) as { uid: number; account_id: string; path: string } | undefined
  if (!row) return null
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(messageId)
  emit('mail:changed', { accountId: row.account_id })
  return { uid: row.uid, accountId: row.account_id, path: row.path }
}

function removeOnServer(client: ImapFlow, draft: DraftLocation): Promise<void> {
  return inMailbox(client, draft.path, async () => {
    await client.messageDelete([draft.uid], { uid: true })
  })
}

export async function deleteDraft(messageId: string): Promise<void> {
  const draft = forgetDraft(messageId)
  if (!draft) return
  await withImap(getAccount(draft.accountId), (client) => removeOnServer(client, draft))
}
