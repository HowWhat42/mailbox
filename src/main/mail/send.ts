import { basename } from 'node:path'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type { OutgoingMessage } from '@shared/types'
import { getAccount, getSecret } from '../accounts/store'
import { googleAccessToken } from '../accounts/google'
import { inMailbox, withImap } from './imap'
import { describeError, foldersOf, syncFolder } from './sync'

export async function sendMessage(msg: OutgoingMessage): Promise<void> {
  const account = getAccount(msg.accountId)
  const mail = new MailComposer({
    from: { name: account.name, address: account.email },
    to: msg.to,
    cc: msg.cc || undefined,
    bcc: msg.bcc || undefined,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    inReplyTo: msg.inReplyTo ? `<${msg.inReplyTo}>` : undefined,
    references: msg.references.length ? msg.references.map((r) => `<${r}>`).join(' ') : undefined,
    attachments: msg.attachments.map((a) => ({ path: a.path, filename: basename(a.path) }))
  }).compile()
  // Bcc must reach the SMTP envelope but never the stored headers.
  mail.keepBcc = false
  const envelope = mail.getEnvelope()
  if (!envelope.to.length) throw new Error('Aucun destinataire valide.')
  const raw = await mail.build()

  const transport = nodemailer.createTransport({
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
    throw new Error(`Envoi impossible : ${describeError(err)}`)
  } finally {
    transport.close()
  }

  // Gmail files sent mail itself; other servers need an explicit copy in Sent.
  const sent = foldersOf(account.id).find((f) => f.role === 'sent')
  if (!sent) return
  await withImap(account, async (client) => {
    if (account.kind !== 'google') {
      await inMailbox(client, sent.path, async () => {
        await client.append(sent.path, raw, ['\\Seen'])
      })
    }
    await syncFolder(client, account, sent)
  }).catch(() => {
    // The message is sent; failing to file a copy must not report a send failure.
  })
}
