import type { ImapFlow } from 'imapflow'
import { getAccount, listAccounts } from '../accounts/store'
import { openImap } from './imap'
import { syncAccount } from './sync'

const FULL_SYNC_EVERY = 5 * 60_000
const watchers = new Map<string, { stop: () => void }>()
let timer: NodeJS.Timeout | null = null

/**
 * Keeps one IDLE connection per account on INBOX so new mail shows up
 * immediately, plus a periodic full sync for the other folders.
 */
export function startWatching(): void {
  for (const account of listAccounts()) watch(account.id)
  timer ??= setInterval(() => {
    for (const account of listAccounts()) void syncAccount(account.id).catch(() => {})
  }, FULL_SYNC_EVERY)
}

export function watch(accountId: string): void {
  if (watchers.has(accountId)) return
  let stopped = false
  let client: ImapFlow | null = null
  let retry = 5_000
  let debounce: NodeJS.Timeout | null = null

  const onChange = (): void => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => void syncAccount(accountId, { inboxOnly: true }).catch(() => {}), 400)
  }

  const connect = async (): Promise<void> => {
    if (stopped) return
    try {
      client = await openImap(getAccount(accountId))
      client.on('exists', onChange)
      client.on('expunge', onChange)
      client.on('flags', onChange)
      client.on('close', () => {
        client = null
        if (!stopped) setTimeout(() => void connect(), retry)
      })
      // Selecting INBOX makes imapflow enter IDLE whenever the connection is quiet.
      await client.mailboxOpen('INBOX')
      retry = 5_000
    } catch {
      client = null
      retry = Math.min(retry * 2, 5 * 60_000)
      if (!stopped) setTimeout(() => void connect(), retry)
    }
  }

  watchers.set(accountId, {
    stop: () => {
      stopped = true
      if (debounce) clearTimeout(debounce)
      void client?.logout().catch(() => client?.close())
    }
  })
  void syncAccount(accountId).catch(() => {})
  void connect()
}

export function unwatch(accountId: string): void {
  watchers.get(accountId)?.stop()
  watchers.delete(accountId)
}

export function stopWatching(): void {
  for (const id of [...watchers.keys()]) unwatch(id)
  if (timer) clearInterval(timer)
  timer = null
}
