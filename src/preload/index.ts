import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppEvents, MailboxApi } from '@shared/types'

function invoker<NS extends string>(ns: NS, methods: string[]): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return Object.fromEntries(methods.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`${ns}:${m}`, ...args)]))
}

const api = {
  accounts: invoker('accounts', [
    'list',
    'discover',
    'addImap',
    'addGoogle',
    'addMicrosoft',
    'update',
    'remove',
    'googleConfigured',
    'microsoftConfigured'
  ]),
  mail: invoker('mail', [
    'folders',
    'list',
    'thread',
    'act',
    'actThread',
    'send',
    'sync',
    'openAttachment',
    'saveAttachment',
    'pickFiles',
    'fileInfo',
    'counts',
    'saveDraft',
    'deleteDraft',
    'contacts',
    'unsubscribe',
    'markAllRead',
    'emptyFolder',
    'createFolder',
    'setFolderFavorite',
    'knownLabels',
    'setLabels',
    'bundles',
    'bundleAct',
    'queue',
    'takeFromOutbox',
    'retryOutbox'
  ]),
  calendar: invoker('calendar', [
    'sources',
    'addSource',
    'updateSource',
    'removeSource',
    'calendars',
    'setEnabled',
    'setCalendarColor',
    'setCalendarPrefs',
    'events',
    'upcoming',
    'refresh',
    'create',
    'update',
    'remove',
    'respond',
    'respondToInvite'
  ]),
  settings: invoker('settings', ['get', 'set', 'loginItem']),
  templates: invoker('templates', ['list', 'save', 'remove']),
  rules: invoker('rules', ['list', 'save', 'remove', 'reorder', 'reapply', 'classifySender']),
  updates: invoker('updates', ['status', 'check', 'install']),
  mcp: invoker('mcp', ['status', 'token', 'regenerateToken', 'activity', 'clearActivity']),
  reminders: invoker('reminders', ['list', 'join', 'snooze', 'dismiss', 'open']),
  app: {
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    copyText: (text: string) => ipcRenderer.invoke('app:copyText', text),
    platform: process.platform,
    setTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('app:setTheme', theme),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    on: <K extends keyof AppEvents>(event: K, cb: (payload: AppEvents[K]) => void) => {
      const listener = (_e: unknown, payload: AppEvents[K]): void => cb(payload)
      ipcRenderer.on(`event:${event}`, listener)
      return () => ipcRenderer.removeListener(`event:${event}`, listener)
    }
  }
} as unknown as MailboxApi

contextBridge.exposeInMainWorld('mailbox', api)
