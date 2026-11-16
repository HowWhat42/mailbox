import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ImapAccountInput, MailboxApi } from '@shared/types'
import { emit } from './events'
import { deleteAccount, insertAccount, listAccounts, updateAccount } from './accounts/store'
import { authorizeGoogle, googleConfigured } from './accounts/google'
import { discoverSettings } from './accounts/discover'
import { describeError, syncAccount } from './mail/sync'
import { listFolders, listThreads, threadMessages, unifiedCounts } from './mail/query'
import { applyAction, threadTargets } from './mail/actions'
import { sendMessage } from './mail/send'
import { openAttachment, saveAttachment } from './mail/attachments'
import { unwatch, watch } from './mail/watch'
import { forgetCaldav } from './calendar/caldav'
import { createEvent, deleteEvent, listCalendars, listEvents, refreshCalendars, setCalendarEnabled, updateEvent } from './calendar'

type Handlers = {
  [NS in keyof MailboxApi as NS extends 'app' ? never : NS]: {
    [M in keyof MailboxApi[NS]]: MailboxApi[NS][M]
  }
}

const handlers: Handlers = {
  accounts: {
    list: async () => listAccounts(),
    discover: (email) => discoverSettings(email),
    googleConfigured: async () => googleConfigured(),
    addImap: async (input) => {
      // Validate credentials before storing anything.
      const draft = await testImap(input)
      const account = insertAccount(draft, { password: input.password })
      emit('accounts:changed', {})
      watch(account.id)
      return account
    },
    addGoogle: async () => {
      const { email, name, refreshToken } = await authorizeGoogle()
      const account = insertAccount(
        {
          kind: 'google',
          name,
          email,
          imapHost: 'imap.gmail.com',
          imapPort: 993,
          imapSecure: true,
          smtpHost: 'smtp.gmail.com',
          smtpPort: 465,
          smtpSecure: true,
          username: email,
          caldavUrl: null
        },
        { refreshToken }
      )
      emit('accounts:changed', {})
      watch(account.id)
      return account
    },
    update: async (id, patch) => {
      updateAccount(id, patch)
      if ('caldavUrl' in patch) forgetCaldav(id)
      emit('accounts:changed', {})
    },
    remove: async (id) => {
      unwatch(id)
      forgetCaldav(id)
      deleteAccount(id)
      emit('accounts:changed', {})
      emit('mail:changed', { accountId: id })
    }
  },
  mail: {
    folders: async () => listFolders(),
    list: async (view, limit) => listThreads(view, limit),
    thread: (accountId, threadId) => threadMessages(accountId, threadId),
    act: (ids, action) => applyAction(ids, action),
    actThread: (accountId, threadId, folderId, action) =>
      applyAction(threadTargets(accountId, threadId, folderId, action), action),
    send: (msg) => sendMessage(msg),
    sync: async (accountId) => {
      const ids = accountId ? [accountId] : listAccounts().map((a) => a.id)
      const results = await Promise.allSettled(ids.map((id) => syncAccount(id)))
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failed.length) throw new Error(failed.map((f) => (f.reason as Error).message).join('\n'))
    },
    openAttachment: (messageId, attachmentId) => openAttachment(messageId, attachmentId),
    saveAttachment: (messageId, attachmentId) => saveAttachment(messageId, attachmentId),
    pickFiles: async () => {
      const win = BrowserWindow.getFocusedWindow()
      const opts = { properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[] }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return res.filePaths.map((p) => ({ path: p, name: basename(p), size: statSync(p).size }))
    },
    counts: async () => unifiedCounts()
  },
  calendar: {
    calendars: async () => listCalendars(),
    setEnabled: async (id, enabled) => setCalendarEnabled(id, enabled),
    events: async (start, end) => listEvents(start, end),
    refresh: (start, end) => refreshCalendars(start, end),
    create: (input) => createEvent(input),
    update: (id, input) => updateEvent(id, input),
    remove: (id) => deleteEvent(id)
  }
}

async function testImap(input: ImapAccountInput) {
  const draft = imapDraft(input)
  const { ImapFlow } = await import('imapflow')
  const client = new ImapFlow({
    host: draft.imapHost,
    port: draft.imapPort,
    secure: draft.imapSecure,
    auth: { user: draft.username, pass: input.password },
    logger: false
  })
  client.on('error', () => {})
  try {
    await client.connect()
    await client.logout()
  } catch (err) {
    client.close()
    throw new Error(describeError(err))
  }
  return draft
}

function imapDraft(input: ImapAccountInput) {
  return {
    kind: 'imap' as const,
    name: input.name.trim() || input.email.trim(),
    email: input.email.trim(),
    imapHost: input.imapHost.trim(),
    imapPort: input.imapPort,
    imapSecure: input.imapSecure,
    smtpHost: input.smtpHost.trim(),
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    username: input.username.trim() || input.email.trim(),
    caldavUrl: input.caldavUrl?.trim() || null
  }
}

export function registerIpc(): void {
  for (const [ns, methods] of Object.entries(handlers)) {
    for (const [name, fn] of Object.entries(methods as Record<string, (...args: unknown[]) => unknown>)) {
      ipcMain.handle(`${ns}:${name}`, async (_e, ...args: unknown[]) => fn(...args))
    }
  }
  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    // Only hand web and mail links to the OS; never file:// or custom schemes from message content.
    if (/^(https?|mailto):/i.test(url)) await shell.openExternal(url)
  })
}
