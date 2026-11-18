import { ImapFlow } from 'imapflow'
import type { Account } from '@shared/types'
import { getSecret } from '../accounts/store'
import { googleAccessToken } from '../accounts/google'
import { microsoftAccessToken } from '../accounts/microsoft'

export async function imapAuth(account: Account): Promise<{ user: string; pass?: string; accessToken?: string }> {
  if (account.kind === 'google') return { user: account.email, accessToken: await googleAccessToken(account.id) }
  if (account.kind === 'microsoft') return { user: account.email, accessToken: await microsoftAccessToken(account.id) }
  return { user: account.username, pass: (await getSecret(account.id)).password ?? '' }
}

export async function openImap(account: Account): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: await imapAuth(account),
    logger: false,
    emitLogs: false,
    qresync: false
  })
  // Without a listener, a socket error would crash the main process.
  client.on('error', () => {})
  await client.connect()
  return client
}

/** Runs `fn` with a fresh connection and always logs out. */
export async function withImap<T>(account: Account, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = await openImap(account)
  try {
    return await fn(client)
  } finally {
    await client.logout().catch(() => client.close())
  }
}

/** Runs `fn` with `path` selected, holding imapflow's mailbox lock. */
export async function inMailbox<T>(client: ImapFlow, path: string, fn: () => Promise<T>): Promise<T> {
  const lock = await client.getMailboxLock(path)
  try {
    return await fn()
  } finally {
    lock.release()
  }
}
