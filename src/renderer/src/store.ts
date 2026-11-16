import { create } from 'zustand'
import type { Account, Address, Folder, MailFilter, MailView, MessageAction, OutgoingAttachment, ThreadSummary } from '@shared/types'

export const api = window.mailbox

export type ComposeKind = 'new' | 'reply' | 'replyAll' | 'forward' | 'draft'

export interface ComposeDraft {
  key: string
  kind: ComposeKind
  accountId: string
  to: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  html: string
  inReplyTo: string | null
  references: string[]
  attachments: OutgoingAttachment[]
  draftId: string | null
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
  action?: { label: string; run: () => void }
}

export interface DialogRequest {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  resolve: (ok: boolean) => void
}

type Mode = 'mail' | 'calendar'
type Theme = 'dark' | 'light'

const PAGE = 150
const UNDO_MS = 5000
const MOVE_ACTIONS = new Set<MessageAction>(['archive', 'trash', 'junk', 'move'])

const ACTION_DONE: Partial<Record<MessageAction, [string, string]>> = {
  archive: ['Conversation archivée', 'conversations archivées'],
  trash: ['Conversation supprimée', 'conversations supprimées'],
  junk: ['Marquée comme indésirable', 'marquées comme indésirables'],
  move: ['Conversation déplacée', 'conversations déplacées']
}

interface Pending {
  timer: ReturnType<typeof setTimeout>
  commit: () => void
}

interface State {
  ready: boolean
  mode: Mode
  theme: Theme
  sidebarCollapsed: boolean
  /** Window width, drives the responsive layout (see lib/layout). */
  viewport: number
  drawerOpen: boolean
  accounts: Account[]
  folders: Folder[]
  counts: { inbox: number; flagged: number }
  syncing: Record<string, boolean>
  view: MailView
  filter: MailFilter
  threads: ThreadSummary[]
  limit: number
  selected: string | null
  checked: Set<string>
  hidden: Set<string>
  composer: ComposeDraft | null
  paletteOpen: boolean
  setupOpen: boolean
  settingsOpen: boolean
  movePicker: ThreadSummary[] | null
  toasts: Toast[]
  dialog: DialogRequest | null

  init(): Promise<void>
  refreshAccounts(): Promise<void>
  refreshMail(): Promise<void>
  setMode(mode: Mode): void
  setTheme(theme: Theme): void
  toggleSidebar(): void
  setDrawer(open: boolean): void
  setView(view: MailView): void
  setFilter(filter: MailFilter): void
  loadMore(): void
  select(key: string | null): void
  move(delta: 1 | -1): void
  toggleCheck(key: string): void
  setChecked(keys: string[]): void
  /** Threads an action applies to: the checked ones, else the selected one. */
  targets(): ThreadSummary[]
  act(threads: ThreadSummary[], action: MessageAction, destFolderId?: string): Promise<void>
  flushPending(): void
  compose(draft?: Partial<ComposeDraft>): void
  updateComposer(patch: Partial<ComposeDraft>): void
  closeComposer(): void
  setPalette(open: boolean): void
  setSetup(open: boolean): void
  setSettings(open: boolean): void
  openMovePicker(threads: ThreadSummary[] | null): void
  toast(text: string, tone?: Toast['tone'], action?: Toast['action']): number
  dismiss(id: number): void
  undoLast(): void
}

export const threadKey = (t: Pick<ThreadSummary, 'accountId' | 'threadId'>): string => `${t.accountId}|${t.threadId}`

function readPref<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable: preference just won't persist
  }
}

let toastId = 0
let pendingId = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null
const pending = new Map<number, Pending>()

/** Ask the user to confirm something, inside the app (never a native dialog). */
export function confirmDialog(opts: Omit<DialogRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useStore.setState({
      dialog: {
        ...opts,
        resolve: (ok) => {
          useStore.setState({ dialog: null })
          resolve(ok)
        }
      }
    })
  })
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  mode: 'mail',
  theme: readPref('theme', ['dark', 'light'], 'dark'),
  sidebarCollapsed: readPref('sidebar', ['open', 'collapsed'], 'open') === 'collapsed',
  viewport: window.innerWidth,
  drawerOpen: false,
  accounts: [],
  folders: [],
  counts: { inbox: 0, flagged: 0 },
  syncing: {},
  view: { type: 'unified', role: 'inbox' },
  filter: 'all',
  threads: [],
  limit: PAGE,
  selected: null,
  checked: new Set(),
  hidden: new Set(),
  composer: null,
  paletteOpen: false,
  setupOpen: false,
  settingsOpen: false,
  movePicker: null,
  toasts: [],
  dialog: null,

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
    window.addEventListener('beforeunload', () => get().flushPending())
    let frame = 0
    window.addEventListener('resize', () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => set({ viewport: window.innerWidth, drawerOpen: false }))
    })
  },

  async refreshAccounts() {
    set({ accounts: await api.accounts.list() })
  },

  async refreshMail() {
    const { view, filter, limit } = get()
    const [folders, threads, counts] = await Promise.all([api.mail.folders(), api.mail.list(view, filter, limit), api.mail.counts()])
    // Ignore stale responses if the view changed meanwhile.
    if (get().view !== view || get().filter !== filter) return
    const hidden = get().hidden
    const visible = threads.filter((t) => !hidden.has(threadKey(t)))
    const keys = new Set(visible.map(threadKey))
    set({ folders, threads: visible, counts, checked: new Set([...get().checked].filter((k) => keys.has(k))) })
  },

  setMode(mode) {
    set({ mode })
  },

  setTheme(theme) {
    document.documentElement.dataset.theme = theme
    writePref('theme', theme)
    void api.app.setTheme(theme)
    set({ theme })
  },

  setDrawer(open) {
    set({ drawerOpen: open })
  },

  toggleSidebar() {
    if (get().viewport < 760) {
      set({ drawerOpen: !get().drawerOpen })
      return
    }
    const collapsed = !get().sidebarCollapsed
    writePref('sidebar', collapsed ? 'collapsed' : 'open')
    set({ sidebarCollapsed: collapsed })
  },

  setView(view) {
    set({ view, mode: 'mail', selected: null, checked: new Set(), limit: PAGE, threads: [], filter: 'all', composer: null })
    void get().refreshMail()
  },

  setFilter(filter) {
    set({ filter, selected: null, checked: new Set(), limit: PAGE, threads: [] })
    void get().refreshMail()
  },

  loadMore() {
    const { threads, limit } = get()
    if (threads.length < limit) return
    set({ limit: limit + PAGE })
    void get().refreshMail()
  },

  select(key) {
    // Opening a conversation puts the composer away; it saves itself as a draft on unmount.
    set({ selected: key, composer: null })
  },

  move(delta) {
    const { threads, selected } = get()
    if (!threads.length) return
    const idx = threads.findIndex((t) => threadKey(t) === selected)
    const next = idx === -1 ? 0 : Math.min(threads.length - 1, Math.max(0, idx + delta))
    set({ selected: threadKey(threads[next]) })
  },

  toggleCheck(key) {
    const checked = new Set(get().checked)
    if (checked.has(key)) checked.delete(key)
    else checked.add(key)
    set({ checked })
  },

  setChecked(keys) {
    set({ checked: new Set(keys) })
  },

  targets() {
    const { threads, checked, selected } = get()
    if (checked.size) return threads.filter((t) => checked.has(threadKey(t)))
    const current = threads.find((t) => threadKey(t) === selected)
    return current ? [current] : []
  },

  async act(list, action, destFolderId) {
    if (!list.length) return
    const keys = new Set(list.map(threadKey))
    const run = (): Promise<unknown> =>
      Promise.all(list.map((t) => api.mail.actThread(t.accountId, t.threadId, t.folderId, action, destFolderId))).catch((err: Error) => {
        get().toast(err.message, 'error')
        void get().refreshMail()
      })

    if (!MOVE_ACTIONS.has(action)) {
      const patch: Partial<ThreadSummary> =
        action === 'read' ? { unread: false } : action === 'unread' ? { unread: true } : action === 'flag' ? { flagged: true } : { flagged: false }
      set({ threads: get().threads.map((t) => (keys.has(threadKey(t)) ? { ...t, ...patch } : t)) })
      await run()
      return
    }

    // Hide now, hit the server only once the undo window has passed.
    const { threads, selected } = get()
    const idx = threads.findIndex((t) => threadKey(t) === selected)
    const rest = threads.filter((t) => !keys.has(threadKey(t)))
    const nextSelected = selected && keys.has(selected) ? (rest[Math.min(idx, rest.length - 1)] ? threadKey(rest[Math.min(idx, rest.length - 1)]) : null) : selected
    set({ threads: rest, selected: nextSelected, checked: new Set(), hidden: new Set([...get().hidden, ...keys]) })

    const id = ++pendingId
    const unhide = (): void => {
      const hidden = new Set(get().hidden)
      for (const k of keys) hidden.delete(k)
      set({ hidden })
    }
    const commit = (): void => {
      pending.delete(id)
      void run().finally(unhide)
    }
    pending.set(id, { timer: setTimeout(commit, UNDO_MS), commit })

    const [one, many] = ACTION_DONE[action]!
    get().toast(list.length === 1 ? one : `${list.length} ${many}`, 'info', {
      label: 'Annuler',
      run: () => {
        const p = pending.get(id)
        if (!p) return
        clearTimeout(p.timer)
        pending.delete(id)
        unhide()
        set({ selected: selected })
        void get().refreshMail()
      }
    })
  },

  flushPending() {
    for (const [, p] of pending) {
      clearTimeout(p.timer)
      p.commit()
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
      mode: 'mail',
      composer: {
        key: crypto.randomUUID(),
        kind: 'new',
        accountId,
        to: [],
        cc: [],
        bcc: [],
        subject: '',
        html: '',
        inReplyTo: null,
        references: [],
        attachments: [],
        draftId: null,
        ...draft
      }
    })
  },

  updateComposer(patch) {
    const current = get().composer
    if (current) set({ composer: { ...current, ...patch } })
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
  openMovePicker(threads) {
    set({ movePicker: threads && threads.length ? threads : null })
  },

  toast(text, tone = 'info', action) {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone, action }] })
    // A toast with an undo lives exactly as long as the undo window.
    setTimeout(() => get().dismiss(id), action ? UNDO_MS : tone === 'error' ? 7000 : 3200)
    return id
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
  undoLast() {
    const last = [...get().toasts].reverse().find((t) => t.action)
    if (!last?.action) return
    last.action.run()
    get().dismiss(last.id)
  }
}))
