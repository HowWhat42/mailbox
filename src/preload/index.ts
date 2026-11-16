import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppEvents, MailboxApi } from '@shared/types'

function invoker<NS extends string>(ns: NS, methods: string[]): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return Object.fromEntries(methods.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`${ns}:${m}`, ...args)]))
}

const api = {
  accounts: invoker('accounts', ['list', 'discover', 'addImap', 'addGoogle', 'update', 'remove', 'googleConfigured']),
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
    'respond'
  ]),
  settings: invoker('settings', ['get', 'set', 'loginItem']),
  rules: invoker('rules', ['list', 'save', 'remove', 'reorder', 'reapply', 'classifySender']),
  reminders: invoker('reminders', ['list', 'join', 'snooze', 'dismiss', 'open']),
  app: {
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
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
