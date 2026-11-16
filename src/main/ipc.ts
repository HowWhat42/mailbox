import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ImapAccountInput, MailboxApi, OutgoingAttachment } from '@shared/types'
import { emit } from './events'
import { deleteAccount, insertAccount, listAccounts, updateAccount } from './accounts/store'
import { authorizeGoogle, googleConfigured } from './accounts/google'
import { discoverSettings } from './accounts/discover'
import { describeError, syncAccount } from './mail/sync'
import { bundleMessageIds, listBundles, listFolders, listThreads, searchContacts, threadMessages, unifiedCounts } from './mail/query'
import { applyAction, threadTargets } from './mail/actions'
import { deleteDraft, saveDraft, sendMessage } from './mail/send'
import { openAttachment, saveAttachment } from './mail/attachments'
import { unwatch, watch } from './mail/watch'
import { forgetCaldav } from './calendar/caldav'
import {
  createEvent,
  deleteEvent,
  listCalendars,
  listEvents,
  refreshCalendars,
  refreshSource,
  respondToEvent,
  setCalendarColor,
  setCalendarEnabled,
  setCalendarPrefs,
  upcomingEvents,
  updateEvent
} from './calendar'
import { addSource, listSources, removeSource, syncAccountSources, updateSource } from './calendar/sources'
import { activeReminders, dismissReminder, joinReminder, openReminder, snoozeReminder } from './calendar/reminders'
import { getSettings, loginItemStatus, setSettings } from './settings'
import { classifySender, listRules, reapplyRules, removeRule, reorderRules, saveRule } from './mail/rules'
import { unsubscribe } from './mail/unsubscribe'

const DAY = 86_400_000

/** Linked calendar sources follow their mail account; refresh them in the background. */
function accountsChanged(): void {
  syncAccountSources()
  for (const s of listSources()) forgetCaldav(s.id)
  const now = Date.now()
  void refreshCalendars(now - 7 * DAY, now + 35 * DAY).catch(() => {})
}

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
      accountsChanged()
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
      accountsChanged()
      return account
    },
    update: async (id, patch) => {
      updateAccount(id, patch)
      if ('caldavUrl' in patch) accountsChanged()
      emit('accounts:changed', {})
    },
    remove: async (id) => {
      unwatch(id)
      deleteAccount(id)
      syncAccountSources()
      emit('accounts:changed', {})
      emit('mail:changed', { accountId: id })
    }
  },
  mail: {
    folders: async () => listFolders(),
    list: async (view, filter, scope, limit) => listThreads(view, filter, scope, limit),
    bundles: async (view, categories) => listBundles(view, categories),
    bundleAct: async (view, category, action) => {
      const ids = bundleMessageIds(view, category, action === 'read')
      await applyAction(ids, action)
      return ids.length
    },
    thread: (accountId, threadId) => threadMessages(accountId, threadId),
    act: (ids, action) => applyAction(ids, action),
    actThread: (accountId, threadId, folderId, action, destFolderId) =>
      applyAction(threadTargets(accountId, threadId, folderId, action), action, destFolderId),
    send: (msg) => sendMessage(msg),
    saveDraft: (msg) => saveDraft(msg),
    deleteDraft: (id) => deleteDraft(id),
    contacts: async (query) => searchContacts(query),
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
      return fileInfo(res.filePaths)
    },
    fileInfo: async (paths) => fileInfo(paths),
    counts: async () => unifiedCounts(),
    unsubscribe: (messageId) => unsubscribe(messageId)
  },
  rules: {
    list: async () => listRules(),
    save: async (rule) => saveRule(rule),
    remove: async (id) => removeRule(id),
    reorder: async (ids) => reorderRules(ids),
    reapply: async () => reapplyRules(),
    classifySender: async (address, category) => classifySender(address, category)
  },
  calendar: {
    sources: async () => listSources(),
    addSource: async (input) => {
      const source = await addSource(input)
      const now = Date.now()
      try {
        await refreshSource(source.id, now - 7 * DAY, now + 35 * DAY)
        // An unnamed subscription takes the name its feed publishes.
        if (input.kind === 'ics' && !input.name.trim()) {
          const published = listCalendars().find((c) => c.sourceId === source.id)?.name
          if (published) updateSource(source.id, { name: published })
        }
      } catch (err) {
        // A source that can't be read on first try is not kept: the user fixes the details and retries.
        removeSource(source.id)
        throw err
      }
      return source
    },
    updateSource: async (id, patch) => updateSource(id, patch),
    removeSource: async (id) => {
      forgetCaldav(id)
      removeSource(id)
      emit('calendar:changed', { sourceId: id })
    },
    calendars: async () => listCalendars(),
    setEnabled: async (id, enabled) => setCalendarEnabled(id, enabled),
    setCalendarColor: async (id, color) => setCalendarColor(id, color),
    setCalendarPrefs: async (id, prefs) => {
      setCalendarPrefs(id, prefs)
      emit('calendar:changed', { sourceId: '' })
    },
    events: async (start, end) => listEvents(start, end),
    upcoming: async (limit) => upcomingEvents(limit),
    refresh: (start, end) => refreshCalendars(start, end),
    create: (input) => createEvent(input),
    update: (id, input) => updateEvent(id, input),
    remove: (id) => deleteEvent(id),
    respond: (id, status) => respondToEvent(id, status)
  },
  settings: {
    get: async () => getSettings(),
    set: async (patch) => setSettings(patch),
    loginItem: async () => loginItemStatus()
  },
  reminders: {
    list: async () => activeReminders(),
    join: (key) => joinReminder(key),
    snooze: async (key, minutes) => snoozeReminder(key, minutes),
    dismiss: async (key) => dismissReminder(key),
    open: async (key) => openReminder(key)
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
    throw new Error(describeError(err), { cause: err })
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

function fileInfo(paths: string[]): OutgoingAttachment[] {
  return paths
    .filter((p) => {
      try {
        return statSync(p).isFile()
      } catch {
        return false
      }
    })
    .map((p) => ({ kind: 'file', path: p, name: basename(p), size: statSync(p).size }))
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
