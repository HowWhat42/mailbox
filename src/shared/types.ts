export type AccountKind = 'imap' | 'google'

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
}

export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged' | null

export interface Folder {
  id: string
  accountId: string
  path: string
  name: string
  role: FolderRole
  unread: number
  total: number
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
}

/** A list view: unified (all accounts) role-based box, or a specific folder. */
export type MailView =
  | { type: 'unified'; role: 'inbox' | 'flagged' | 'sent' | 'drafts' }
  | { type: 'folder'; folderId: string }
  | { type: 'search'; query: string }

export type MessageAction = 'read' | 'unread' | 'flag' | 'unflag' | 'archive' | 'trash' | 'junk' | 'move'

export type MailFilter = 'all' | 'unread' | 'flagged' | 'attachments'

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

export interface Calendar {
  id: string
  accountId: string
  name: string
  color: string
  readOnly: boolean
  enabled: boolean
}

export interface CalendarEvent {
  id: string
  calendarId: string
  accountId: string
  title: string
  location: string
  description: string
  start: number
  end: number
  allDay: boolean
  recurring: boolean
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

export interface SyncStatus {
  accountId: string
  state: 'idle' | 'syncing' | 'error'
  message: string | null
}

export interface AppEvents {
  'mail:changed': { accountId: string }
  'sync:status': SyncStatus
  'calendar:changed': { accountId: string }
  'accounts:changed': Record<string, never>
}

export interface MailboxApi {
  accounts: {
    list(): Promise<Account[]>
    discover(email: string): Promise<ServerSettings | null>
    addImap(input: ImapAccountInput): Promise<Account>
    addGoogle(): Promise<Account>
    update(id: string, patch: Partial<Pick<Account, 'name' | 'color' | 'signature' | 'caldavUrl'>>): Promise<void>
    remove(id: string): Promise<void>
    googleConfigured(): Promise<boolean>
  }
  mail: {
    folders(): Promise<Folder[]>
    list(view: MailView, filter: MailFilter, limit: number): Promise<ThreadSummary[]>
    thread(accountId: string, threadId: string): Promise<MessageDetail[]>
    act(messageIds: string[], action: MessageAction): Promise<void>
    actThread(accountId: string, threadId: string, folderId: string, action: MessageAction, destFolderId?: string): Promise<void>
    send(msg: OutgoingMessage): Promise<void>
    /** Saves (or replaces) a draft on the server; returns the new draft's local id, or null if the account has no Drafts folder. */
    saveDraft(msg: OutgoingMessage): Promise<{ id: string; attachments: OutgoingAttachment[] } | null>
    deleteDraft(messageId: string): Promise<void>
    contacts(query: string): Promise<Address[]>
    sync(accountId?: string): Promise<void>
    openAttachment(messageId: string, attachmentId: string): Promise<void>
    saveAttachment(messageId: string, attachmentId: string): Promise<void>
    pickFiles(): Promise<OutgoingAttachment[]>
    fileInfo(paths: string[]): Promise<OutgoingAttachment[]>
    counts(): Promise<{ inbox: number; flagged: number }>
  }
  calendar: {
    calendars(): Promise<Calendar[]>
    setEnabled(id: string, enabled: boolean): Promise<void>
    events(start: number, end: number): Promise<CalendarEvent[]>
    refresh(start: number, end: number): Promise<void>
    create(input: EventInput): Promise<void>
    update(id: string, input: EventInput): Promise<void>
    remove(id: string): Promise<void>
  }
  app: {
    openExternal(url: string): Promise<void>
    setTheme(theme: 'dark' | 'light'): Promise<void>
    /** Absolute path of a dropped File (sync, via webUtils). */
    pathForFile(file: File): string
    on<K extends keyof AppEvents>(event: K, cb: (payload: AppEvents[K]) => void): () => void
  }
}
