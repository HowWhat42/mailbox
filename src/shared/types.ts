export type AccountKind = 'imap' | 'google'

/** A reusable message of an account. `{{Field}}` in the subject or body is asked for when it's used. */
export interface MailTemplate {
  id: string
  accountId: string
  name: string
  subject: string
  html: string
  to: Address[]
  cc: Address[]
  updatedAt: number
}

export type MailTemplateInput = Omit<MailTemplate, 'id' | 'updatedAt'> & { id?: string }

export interface Account {
  id: string
  kind: AccountKind
  name: string
  email: string
  color: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  caldavUrl: string | null
  signature: string
  lastSyncAt: number | null
  syncError: string | null
  /** Per-account preferences. */
  /** Short name shown on markers ("Pro", "Perso"); empty = derived from the name. */
  label: string
  notify: boolean
  inUnified: boolean
  /** Newest messages kept per folder. */
  syncDepth: number
}

export interface ImapAccountInput {
  name: string
  email: string
  username: string
  password: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  caldavUrl: string | null
}

export interface ServerSettings {
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  /** Where the settings came from, e.g. "iCloud" or "OVHcloud (via MX)". */
  provider?: string
  /** Provider-specific advice (app passwords, Bridge…). */
  note?: string
}

export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged' | 'important' | null

export interface Folder {
  id: string
  accountId: string
  path: string
  name: string
  role: FolderRole
  unread: number
  total: number
  /** Path of the parent folder on the server, for nested folders and Gmail sub-labels. */
  parentPath: string | null
  /** Pinned to the "Favoris" section of the sidebar. */
  favorite: boolean
}

export interface Address {
  name: string
  address: string
}

/** One row in the message list: the latest message of a thread within a view. */
export interface ThreadSummary {
  threadId: string
  accountId: string
  messageId: string
  subject: string
  snippet: string
  from: Address
  to: Address[]
  participants: string[]
  date: number
  unread: boolean
  flagged: boolean
  hasAttachments: boolean
  count: number
  folderId: string
  folderRole: FolderRole
  category: MailCategory
  /** The sender offers List-Unsubscribe. */
  canUnsubscribe: boolean
}

export interface Attachment {
  id: string
  filename: string
  contentType: string
  size: number
}

export interface MessageDetail {
  id: string
  accountId: string
  folderId: string
  threadId: string
  subject: string
  from: Address
  to: Address[]
  cc: Address[]
  bcc: Address[]
  replyTo: Address[]
  date: number
  unread: boolean
  flagged: boolean
  messageIdHeader: string | null
  references: string[]
  html: string | null
  text: string | null
  attachments: Attachment[]
  /** Body not downloaded yet and the server can't be reached: shown once back online. */
  unavailable: boolean
}

/** A list view: unified (all accounts) role-based box, or a specific folder. */
export type MailView =
  | { type: 'unified'; role: 'inbox' | 'flagged' | 'sent' | 'drafts' }
  | { type: 'folder'; folderId: string }
  | { type: 'search'; query: string }

export type MessageAction = 'read' | 'unread' | 'flag' | 'unflag' | 'archive' | 'trash' | 'junk' | 'move'

export type MailFilter = 'all' | 'unread' | 'flagged' | 'attachments'

/** Smart-inbox buckets (Spark-style). */
export type MailCategory = 'people' | 'notifications' | 'newsletters' | 'invitations'
export const MAIL_CATEGORIES: MailCategory[] = ['people', 'notifications', 'newsletters', 'invitations']

/** Which part of a box a list shows: everything, one category, or everything except bundled categories. */
export type MailScope = 'all' | MailCategory | { exclude: MailCategory[] }

/** A Spark-style bundle row: one category of the inbox, summarised by sender. */
export interface Bundle {
  category: MailCategory
  threads: number
  unread: number
  latest: number
  senders: { name: string; address: string; count: number; unread: number }[]
  moreSenders: number
  /** Accounts that have mail in this bundle. */
  accounts: string[]
}

export type RuleField = 'from' | 'domain' | 'to' | 'subject'
export type RuleOp = 'contains' | 'is'

export interface RuleCondition {
  field: RuleField
  op: RuleOp
  value: string
}

export interface RuleActions {
  category?: MailCategory
  markRead?: boolean
  star?: boolean
  /** Folder id (must belong to the account the rule applies to). */
  moveTo?: string
  mute?: boolean
}

export interface MailRule {
  id: string
  name: string
  enabled: boolean
  /** null = every account. */
  accountId: string | null
  conditions: RuleCondition[]
  actions: RuleActions
}

/** A file from disk, or an attachment of an existing message (forward, reopened draft). */
export type OutgoingAttachment =
  | { kind: 'file'; path: string; name: string; size: number }
  | { kind: 'message'; messageId: string; attachmentId: string; name: string; size: number }

export interface OutgoingMessage {
  accountId: string
  to: string
  cc: string
  bcc: string
  subject: string
  html: string
  text: string
  inReplyTo: string | null
  references: string[]
  attachments: OutgoingAttachment[]
  /** Local id of the server-side draft this message replaces, if any. */
  draftId: string | null
}

export type CalendarSourceKind = 'google' | 'caldav' | 'ics'

/** Where calendars come from: a mail account's Google/CalDAV, or a standalone connection. */
export interface CalendarSource {
  id: string
  kind: CalendarSourceKind
  name: string
  color: string
  /** Set when the source rides on a mail account's credentials. */
  accountId: string | null
  url: string | null
  username: string | null
  syncError: string | null
  lastSyncAt: number | null
}

export type CalendarSourceInput =
  | { kind: 'google' }
  | { kind: 'caldav'; name: string; url: string; username: string; password: string }
  | { kind: 'ics'; name: string; url: string }

export interface Calendar {
  id: string
  sourceId: string
  name: string
  color: string
  readOnly: boolean
  enabled: boolean
  notify: boolean
  reminderOverride: number | null
}

export type ResponseStatus = 'accepted' | 'tentative' | 'declined' | 'needsAction'

export interface Attendee {
  name: string
  email: string
  status: ResponseStatus
  organizer: boolean
  self: boolean
}

export interface CalendarEvent {
  id: string
  calendarId: string
  sourceId: string
  title: string
  location: string
  description: string
  start: number
  end: number
  allDay: boolean
  recurring: boolean
  status: 'confirmed' | 'tentative' | 'cancelled'
  meetingUrl: string | null
  meetingProvider: string | null
  attendees: Attendee[]
  organizer: string | null
  /** The user's own answer when invited; null when they are the organizer or not on the list. */
  myStatus: ResponseStatus | null
  /** Minutes before start, from the event or its calendar's defaults. */
  reminders: number[]
  webLink: string | null
}

export interface EventInput {
  calendarId: string
  title: string
  location: string
  description: string
  start: number
  end: number
  allDay: boolean
}

export type ThemeMode = 'dark' | 'light' | 'system'
export type AccountMarker = 'stripe' | 'tag' | 'ring' | 'dot' | 'none'

export interface AppSettings {
  // Général
  /** Keep running in the tray when the window is closed (needed for reminders). */
  backgroundMode: boolean
  launchAtLogin: boolean
  /** Start hidden in the tray when launched at login. */
  startHidden: boolean
  /** -1 = never, 0 = on open, else milliseconds. */
  markReadDelay: number
  undoSeconds: number
  remoteImages: 'block' | 'allow'

  // Apparence
  theme: ThemeMode
  /** Interface zoom; 0 = automatic from the screen size. */
  uiScale: number
  /** Hex colour. */
  accent: string
  backdrop: 'nebula' | 'plain'
  density: 'comfortable' | 'compact'
  /** How a conversation shows which mailbox it comes from (when several accounts are connected). */
  accountMarker: AccountMarker

  // Notifications
  mailNotifications: boolean
  /** Only notify for People and Invitations. */
  smartNotifications: boolean
  mailSound: boolean
  quietHours: boolean
  /** Minutes after midnight. */
  quietStart: number
  quietEnd: number
  /** Used when an event carries no reminder of its own. */
  reminderMinutes: number
  reminderSound: boolean
  /** Online meetings also ping at start time. */
  reminderAtStart: boolean

  // Boîte de réception
  smartInbox: boolean
  /** Categories shown as tabs (People is always shown). */
  categories: MailCategory[]
}

export interface CalendarPrefs {
  notify: boolean
  /** Minutes before start; null = the calendar's own defaults. */
  reminderOverride: number | null
}

/** An event reminder currently shown in the floating notification window. */
export interface Reminder {
  key: string
  eventId: string
  title: string
  start: number
  end: number
  allDay: boolean
  location: string
  meetingUrl: string | null
  meetingProvider: string | null
  color: string
  calendarName: string
}

export interface SyncStatus {
  accountId: string
  /** 'offline': the server can't be reached; changes are queued until it can. */
  state: 'idle' | 'syncing' | 'error' | 'offline'
  message: string | null
}

/** A message waiting in the outbox for the connection to come back. */
export interface QueuedSend {
  id: number
  accountId: string
  to: string
  subject: string
  createdAt: number
  /** Set when the server refused it (it stays until the user acts). */
  lastError: string | null
}

/** In-app updates (installed app only; a dev build reads "unsupported"). */
export interface UpdateStatus {
  state: 'unsupported' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
  /** Running version. */
  current: string
  /** Version being downloaded or ready to install. */
  available?: string
  percent?: number
  error?: string
  checkedAt?: number
}

export interface AppEvents {
  'mail:changed': { accountId: string }
  'sync:status': SyncStatus
  'calendar:changed': { sourceId: string }
  'accounts:changed': Record<string, never>
  'reminders:changed': Record<string, never>
  /** Ask the main window to show an event (from a reminder). */
  'calendar:open': { eventId: string; start: number }
  'settings:changed': AppSettings
  'queue:changed': Record<string, never>
  'update:status': UpdateStatus
}

export interface MailboxApi {
  accounts: {
    list(): Promise<Account[]>
    discover(email: string): Promise<ServerSettings | null>
    addImap(input: ImapAccountInput): Promise<Account>
    addGoogle(): Promise<Account>
    update(
      id: string,
      patch: Partial<Pick<Account, 'name' | 'label' | 'color' | 'signature' | 'caldavUrl' | 'notify' | 'inUnified' | 'syncDepth'>>
    ): Promise<void>
    remove(id: string): Promise<void>
    googleConfigured(): Promise<boolean>
  }
  mail: {
    folders(): Promise<Folder[]>
    list(view: MailView, filter: MailFilter, scope: MailScope, limit: number): Promise<ThreadSummary[]>
    bundles(view: MailView, categories: MailCategory[]): Promise<Bundle[]>
    /** Marks read or archives a whole bundle; returns the number of messages touched. */
    bundleAct(view: MailView, category: MailCategory, action: 'read' | 'archive'): Promise<number>
    thread(accountId: string, threadId: string): Promise<MessageDetail[]>
    act(messageIds: string[], action: MessageAction): Promise<void>
    actThread(accountId: string, threadId: string, folderId: string, action: MessageAction, destFolderId?: string): Promise<void>
    /** 'queued' when offline: the message waits in the outbox. */
    send(msg: OutgoingMessage): Promise<'sent' | 'queued'>
    queue(): Promise<{ actions: number; outbox: QueuedSend[] }>
    /** Removes a message from the outbox and returns it, to edit or discard. */
    takeFromOutbox(id: number): Promise<OutgoingMessage | null>
    retryOutbox(): Promise<void>
    /** Saves (or replaces) a draft on the server; returns the new draft's local id, or null if the account has no Drafts folder. */
    saveDraft(msg: OutgoingMessage): Promise<{ id: string; attachments: OutgoingAttachment[] } | null>
    deleteDraft(messageId: string): Promise<void>
    contacts(query: string): Promise<Address[]>
    sync(accountId?: string): Promise<void>
    openAttachment(messageId: string, attachmentId: string): Promise<void>
    saveAttachment(messageId: string, attachmentId: string): Promise<void>
    pickFiles(): Promise<OutgoingAttachment[]>
    fileInfo(paths: string[]): Promise<OutgoingAttachment[]>
    counts(): Promise<{ inbox: number; flagged: number; categories: Record<MailCategory, number> }>
    unsubscribe(messageId: string): Promise<'done' | 'opened'>
    /** Marks every unread message of a view as read; returns how many. */
    markAllRead(view: MailView, scope: MailScope): Promise<number>
    /** Permanently deletes everything in Trash or Junk; returns how many. */
    emptyFolder(folderId: string): Promise<number>
    /** Creates a folder on the server, at the top of the account or inside `parentId`. */
    createFolder(accountId: string, name: string, parentId?: string): Promise<Folder>
    setFolderFavorite(folderId: string, favorite: boolean): Promise<void>
  }
  templates: {
    /** One account's templates, or all of them. */
    list(accountId?: string): Promise<MailTemplate[]>
    save(input: MailTemplateInput): Promise<MailTemplate>
    remove(id: string): Promise<void>
  }
  rules: {
    list(): Promise<MailRule[]>
    save(rule: MailRule): Promise<MailRule>
    remove(id: string): Promise<void>
    reorder(ids: string[]): Promise<void>
    /** Re-sorts every local message with the current rules; returns how many changed category. */
    reapply(): Promise<number>
    /** One-click "always put mail from this sender in…" (Spark's "move to"). */
    classifySender(address: string, category: MailCategory): Promise<void>
  }
  calendar: {
    sources(): Promise<CalendarSource[]>
    addSource(input: CalendarSourceInput): Promise<CalendarSource>
    updateSource(id: string, patch: { name?: string; color?: string }): Promise<void>
    removeSource(id: string): Promise<void>
    calendars(): Promise<Calendar[]>
    setEnabled(id: string, enabled: boolean): Promise<void>
    setCalendarColor(id: string, color: string): Promise<void>
    setCalendarPrefs(id: string, prefs: Partial<CalendarPrefs>): Promise<void>
    events(start: number, end: number): Promise<CalendarEvent[]>
    /** Next events (today and tomorrow) for the "next up" card. */
    upcoming(limit: number): Promise<CalendarEvent[]>
    refresh(start: number, end: number): Promise<void>
    create(input: EventInput): Promise<void>
    update(id: string, input: EventInput): Promise<void>
    remove(id: string): Promise<void>
    respond(id: string, status: Exclude<ResponseStatus, 'needsAction'>): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    /** Whether the OS will start Mailbox at login right now. */
    loginItem(): Promise<{ enabled: boolean; packaged: boolean }>
  }
  reminders: {
    list(): Promise<Reminder[]>
    join(key: string): Promise<void>
    snooze(key: string, minutes: number): Promise<void>
    dismiss(key: string): Promise<void>
    open(key: string): Promise<void>
  }
  updates: {
    status(): Promise<UpdateStatus>
    /** Checks now; a found update starts downloading on its own. */
    check(): Promise<UpdateStatus>
    /** Restarts into the downloaded version. */
    install(): Promise<void>
  }
  app: {
    openExternal(url: string): Promise<void>
    setTheme(theme: 'dark' | 'light'): Promise<void>
    /** Absolute path of a dropped File (sync, via webUtils). */
    pathForFile(file: File): string
    on<K extends keyof AppEvents>(event: K, cb: (payload: AppEvents[K]) => void): () => void
  }
}
