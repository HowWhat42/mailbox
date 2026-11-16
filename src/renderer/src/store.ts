import { create } from 'zustand'
import type {
  Account,
  Address,
  AppSettings,
  Bundle,
  Folder,
  MailCategory,
  MailFilter,
  MailView,
  MessageAction,
  OutgoingAttachment,
  ThreadSummary,
  UpdateStatus
} from '@shared/types'
import { applyAppearance } from './lib/appearance'

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

type Mode = 'mail' | 'calendar' | 'settings'
export type SettingsSection = 'general' | 'appearance' | 'notifications' | 'inbox' | 'calendars' | 'shortcuts' | `account:${string}`

const PAGE = 150
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
  settings: AppSettings | null
  settingsSection: SettingsSection
  /** Theme actually shown (settings.theme resolved against the OS for 'system'). */
  theme: 'dark' | 'light'
  sidebarCollapsed: boolean
  /** Window width, drives the responsive layout (see lib/layout). */
  viewport: number
  drawerOpen: boolean
  /** Event the calendar should jump to and open (from a reminder or the "next up" card). */
  calendarFocus: { eventId: string; start: number } | null
  accounts: Account[]
  folders: Folder[]
  syncing: Record<string, boolean>
  /** Accounts whose server can't be reached right now. */
  offline: Record<string, boolean>
  queue: { actions: number; outbox: number }
  update: UpdateStatus | null
  outboxOpen: boolean
  view: MailView
  filter: MailFilter
  /** 'smart' = inbox with bundles, a category = inside one bundle, 'all' = plain list. */
  category: MailCategory | 'all' | 'smart'
  bundles: Bundle[]
  counts: { inbox: number; flagged: number; categories: Record<MailCategory, number> }
  threads: ThreadSummary[]
  limit: number
  selected: string | null
  checked: Set<string>
  hidden: Set<string>
  composer: ComposeDraft | null
  paletteOpen: boolean
  setupOpen: boolean
  movePicker: ThreadSummary[] | null
  toasts: Toast[]
  dialog: DialogRequest | null

  init(): Promise<void>
  refreshAccounts(): Promise<void>
  refreshMail(): Promise<void>
  setMode(mode: Mode): void
  openSettings(section?: SettingsSection): void
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  toggleSidebar(): void
  setDrawer(open: boolean): void
  setOutbox(open: boolean): void
  focusEvent(focus: { eventId: string; start: number } | null): void
  setView(view: MailView): void
  setFilter(filter: MailFilter): void
  setCategory(category: MailCategory | 'all' | 'smart'): void
  /** Categories shown as bundles in the smart inbox. */
  bundled(): MailCategory[]
  /** Whether the current view shows smart-inbox tabs. */
  smartView(): boolean
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
  settings: null,
  settingsSection: 'general',
  theme: 'dark',
  sidebarCollapsed: readPref('sidebar', ['open', 'collapsed'], 'open') === 'collapsed',
  viewport: window.innerWidth,
  drawerOpen: false,
  calendarFocus: null,
  accounts: [],
  folders: [],
  counts: { inbox: 0, flagged: 0, categories: { people: 0, notifications: 0, newsletters: 0, invitations: 0 } },
  syncing: {},
  offline: {},
  queue: { actions: 0, outbox: 0 },
  update: null,
  outboxOpen: false,
  view: { type: 'unified', role: 'inbox' },
  filter: 'all',
  category: 'smart',
  bundles: [],
  threads: [],
  limit: PAGE,
  selected: null,
  checked: new Set(),
  hidden: new Set(),
  composer: null,
  paletteOpen: false,
  setupOpen: false,
  movePicker: null,
  toasts: [],
  dialog: null,

  async init() {
    const settings = await api.settings.get()
    const apply = (s: AppSettings): void => {
      const theme = applyAppearance(s)
      void api.app.setTheme(theme)
      set({ settings: s, theme, category: get().smartView() && s.smartInbox ? get().category : 'all' })
      void get().refreshMail()
    }
    apply(settings)
    if (!settings.smartInbox) set({ category: 'all' })
    api.app.on('settings:changed', (s) => {
      const smartChanged = s.smartInbox !== get().settings?.smartInbox
      apply(s)
      if (smartChanged) get().setCategory(s.smartInbox && get().smartView() ? 'smart' : 'all')
    })
    // "Système" follows the OS live.
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      const s = get().settings
      if (s?.theme === 'system') apply(s)
    })
    await get().refreshAccounts()
    await get().refreshMail()
    set({ ready: true, setupOpen: get().accounts.length === 0 })

    api.app.on('mail:changed', () => {
      // Sync emits one event per folder; coalesce them into a single reload.
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void get().refreshMail(), 150)
    })
    api.app.on('accounts:changed', () => void get().refreshAccounts())
    api.app.on('calendar:open', (focus) => get().focusEvent(focus.eventId ? focus : { eventId: '', start: focus.start }))
    const loadQueue = (): void => {
      void api.mail.queue().then((q) => set({ queue: { actions: q.actions, outbox: q.outbox.length } }))
    }
    loadQueue()
    api.app.on('queue:changed', loadQueue)
    void api.updates.status().then((update) => set({ update }))
    api.app.on('update:status', (update) => set({ update }))
    // Back online: replay what was queued right away instead of waiting for the next sync.
    window.addEventListener('online', () => void api.mail.sync().catch(() => {}))
    api.app.on('sync:status', (s) => {
      set({
        syncing: { ...get().syncing, [s.accountId]: s.state === 'syncing' },
        // 'syncing' says nothing about reachability: keep the last known state until it ends.
        offline: s.state === 'syncing' ? get().offline : { ...get().offline, [s.accountId]: s.state === 'offline' }
      })
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
    const { view, filter, limit, category } = get()
    const smart = get().smartView()
    const bundled = get().bundled()
    const scope = !smart || category === 'all' ? 'all' : category === 'smart' ? { exclude: bundled } : category
    const [folders, threads, counts, bundles] = await Promise.all([
      api.mail.folders(),
      api.mail.list(view, filter, scope, limit),
      api.mail.counts(),
      smart && category === 'smart' ? api.mail.bundles(view, bundled) : Promise.resolve([] as Bundle[])
    ])
    // Ignore stale responses if the view changed meanwhile.
    if (get().view !== view || get().filter !== filter || get().category !== category) return
    set({ bundles })
    const hidden = get().hidden
    const visible = threads.filter((t) => !hidden.has(threadKey(t)))
    const keys = new Set(visible.map(threadKey))
    set({ folders, threads: visible, counts, checked: new Set([...get().checked].filter((k) => keys.has(k))) })
  },

  setMode(mode) {
    set({ mode })
  },

  openSettings(section) {
    set({ mode: 'settings', composer: null, settingsSection: section ?? get().settingsSection })
  },

  async updateSettings(patch) {
    // Optimistic: the UI reacts at once, the main process confirms through settings:changed.
    const current = get().settings
    if (current) {
      const next = { ...current, ...patch }
      const theme = applyAppearance(next)
      set({ settings: next, theme })
    }
    await api.settings.set(patch)
  },

  setDrawer(open) {
    set({ drawerOpen: open })
  },

  setOutbox(open) {
    set({ outboxOpen: open })
  },

  focusEvent(focus) {
    set(focus ? { calendarFocus: focus, mode: 'calendar', composer: null } : { calendarFocus: null })
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
    set({ category: get().smartView() ? 'smart' : 'all', bundles: [] })
    void get().refreshMail()
  },

  smartView() {
    const { view, folders, settings } = get()
    if (!settings?.smartInbox) return false
    if (view.type === 'unified') return view.role === 'inbox'
    if (view.type === 'folder') return folders.find((f) => f.id === view.folderId)?.role === 'inbox'
    return false
  },

  bundled() {
    return (get().settings?.categories ?? []).filter((c) => c !== 'people')
  },

  setCategory(category) {
    set({ category, selected: null, checked: new Set(), limit: PAGE, threads: [], bundles: [] })
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
    const nextSelected =
      selected && keys.has(selected) ? (rest[Math.min(idx, rest.length - 1)] ? threadKey(rest[Math.min(idx, rest.length - 1)]) : null) : selected
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
    const undoMs = (get().settings?.undoSeconds ?? 5) * 1000
    pending.set(id, { timer: setTimeout(commit, undoMs), commit })

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
  openMovePicker(threads) {
    set({ movePicker: threads && threads.length ? threads : null })
  },

  toast(text, tone = 'info', action) {
    const id = ++toastId
    // IPC errors arrive as "Error invoking remote method 'x': Error: message": keep the message.
    text = text.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone, action }] })
    // A toast with an undo lives exactly as long as the undo window.
    setTimeout(() => get().dismiss(id), action ? (get().settings?.undoSeconds ?? 5) * 1000 : tone === 'error' ? 7000 : 3200)
    return id
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
  undoLast() {
    const last = get()
      .toasts.toReversed()
      .find((t) => t.action)
    if (!last?.action) return
    last.action.run()
    get().dismiss(last.id)
  }
}))
