import { create } from 'zustand'
import type { Account, Folder, MailView, MessageAction, ThreadSummary } from '@shared/types'

export const api = window.mailbox

export interface ComposeDraft {
  key: string
  accountId: string
  to: string
  cc: string
  bcc: string
  subject: string
  html: string
  inReplyTo: string | null
  references: string[]
  attachments: { path: string; name: string; size: number }[]
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

type Mode = 'mail' | 'calendar'
type Theme = 'dark' | 'light'

const PAGE = 150

interface State {
  ready: boolean
  mode: Mode
  theme: Theme
  accounts: Account[]
  folders: Folder[]
  counts: { inbox: number; flagged: number }
  syncing: Record<string, boolean>
  view: MailView
  threads: ThreadSummary[]
  limit: number
  selected: string | null // `${accountId}|${threadId}`
  composer: ComposeDraft | null
  paletteOpen: boolean
  setupOpen: boolean
  settingsOpen: boolean
  toasts: Toast[]

  init(): Promise<void>
  refreshAccounts(): Promise<void>
  refreshMail(): Promise<void>
  setMode(mode: Mode): void
  setTheme(theme: Theme): void
  setView(view: MailView): void
  loadMore(): void
  select(key: string | null): void
  move(delta: 1 | -1): void
  act(thread: ThreadSummary, action: MessageAction): Promise<void>
  compose(draft?: Partial<ComposeDraft>): void
  closeComposer(): void
  setPalette(open: boolean): void
  setSetup(open: boolean): void
  setSettings(open: boolean): void
  toast(text: string, tone?: Toast['tone']): void
  dismiss(id: number): void
}

export const threadKey = (t: Pick<ThreadSummary, 'accountId' | 'threadId'>): string => `${t.accountId}|${t.threadId}`

function readTheme(): Theme {
  try {
    return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

let toastId = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => ({
  ready: false,
  mode: 'mail',
  theme: readTheme(),
  accounts: [],
  folders: [],
  counts: { inbox: 0, flagged: 0 },
  syncing: {},
  view: { type: 'unified', role: 'inbox' },
  threads: [],
  limit: PAGE,
  selected: null,
  composer: null,
  paletteOpen: false,
  setupOpen: false,
  settingsOpen: false,
  toasts: [],

  async init() {
    get().setTheme(get().theme)
    await get().refreshAccounts()
    await get().refreshMail()
    set({ ready: true, setupOpen: get().accounts.length === 0 })

    api.app.on('mail:changed', () => {
      // Sync emits one event per folder; coalesce them into a single reload.
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void get().refreshMail(), 150)
    })
    api.app.on('accounts:changed', () => void get().refreshAccounts())
    api.app.on('sync:status', (s) => {
      set({ syncing: { ...get().syncing, [s.accountId]: s.state === 'syncing' } })
      if (s.state !== 'syncing') void get().refreshAccounts()
    })
  },

  async refreshAccounts() {
    set({ accounts: await api.accounts.list() })
  },

  async refreshMail() {
    const { view, limit } = get()
    const [folders, threads, counts] = await Promise.all([api.mail.folders(), api.mail.list(view, limit), api.mail.counts()])
    // Ignore stale responses if the view changed meanwhile.
    if (get().view !== view) return
    set({ folders, threads, counts })
  },

  setMode(mode) {
    set({ mode })
  },

  setTheme(theme) {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('theme', theme)
    } catch {
      // storage unavailable: theme just won't persist
    }
    void api.app.setTheme(theme)
    set({ theme })
  },

  setView(view) {
    set({ view, mode: 'mail', selected: null, limit: PAGE, threads: [] })
    void get().refreshMail()
  },

  loadMore() {
    const { threads, limit } = get()
    if (threads.length < limit) return
    set({ limit: limit + PAGE })
    void get().refreshMail()
  },

  select(key) {
    set({ selected: key })
  },

  move(delta) {
    const { threads, selected } = get()
    if (!threads.length) return
    const idx = threads.findIndex((t) => threadKey(t) === selected)
    const next = idx === -1 ? 0 : Math.min(threads.length - 1, Math.max(0, idx + delta))
    set({ selected: threadKey(threads[next]) })
  },

  async act(thread, action) {
    const key = threadKey(thread)
    const removes = action === 'archive' || action === 'trash' || action === 'junk'
    if (removes) {
      // Superhuman-style: selection jumps to the next thread before the server answers.
      const { threads, selected } = get()
      const idx = threads.findIndex((t) => threadKey(t) === key)
      const rest = threads.filter((t) => threadKey(t) !== key)
      set({
        threads: rest,
        selected: selected === key ? (rest[Math.min(idx, rest.length - 1)] ? threadKey(rest[Math.min(idx, rest.length - 1)]) : null) : selected
      })
    } else {
      const patch: Partial<ThreadSummary> =
        action === 'read' ? { unread: false } : action === 'unread' ? { unread: true } : action === 'flag' ? { flagged: true } : { flagged: false }
      set({ threads: get().threads.map((t) => (threadKey(t) === key ? { ...t, ...patch } : t)) })
    }
    try {
      await api.mail.actThread(thread.accountId, thread.threadId, thread.folderId, action)
      const labels: Partial<Record<MessageAction, string>> = { archive: 'Archivé', trash: 'Supprimé', junk: 'Marqué comme indésirable' }
      if (labels[action]) get().toast(labels[action]!)
    } catch (err) {
      get().toast((err as Error).message, 'error')
      void get().refreshMail()
    }
  },

  compose(draft) {
    const { accounts, view, folders } = get()
    const fromFolder = view.type === 'folder' ? folders.find((f) => f.id === view.folderId)?.accountId : undefined
    const accountId = draft?.accountId ?? fromFolder ?? accounts[0]?.id
    if (!accountId) {
      set({ setupOpen: true })
      return
    }
    set({
      composer: {
        key: crypto.randomUUID(),
        accountId,
        to: '',
        cc: '',
        bcc: '',
        subject: '',
        html: '',
        inReplyTo: null,
        references: [],
        attachments: [],
        ...draft
      }
    })
  },

  closeComposer() {
    set({ composer: null })
  },

  setPalette(open) {
    set({ paletteOpen: open })
  },
  setSetup(open) {
    set({ setupOpen: open })
  },
  setSettings(open) {
    set({ settingsOpen: open })
  },

  toast(text, tone = 'info') {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, tone }] })
    setTimeout(() => get().dismiss(id), tone === 'error' ? 7000 : 3200)
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  }
}))
