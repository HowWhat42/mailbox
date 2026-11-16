import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { app } from 'electron'

let db: DatabaseSync | null = null

export function dataDir(...parts: string[]): string {
  const dir = join(app.getPath('userData'), ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getDb(): DatabaseSync {
  if (db) return db
  db = new DatabaseSync(join(dataDir(), 'mailbox.db'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
  migrate(db)
  return db
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    color TEXT NOT NULL,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL,
    imap_secure INTEGER NOT NULL,
    smtp_host TEXT NOT NULL,
    smtp_port INTEGER NOT NULL,
    smtp_secure INTEGER NOT NULL,
    username TEXT NOT NULL,
    secret BLOB NOT NULL,
    caldav_url TEXT,
    signature TEXT NOT NULL DEFAULT '',
    last_sync_at INTEGER,
    sync_error TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    uidvalidity TEXT,
    unread INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    UNIQUE (account_id, path)
  );

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    uid INTEGER NOT NULL,
    thread_id TEXT NOT NULL,
    message_id_header TEXT,
    refs TEXT NOT NULL DEFAULT '[]',
    subject TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    from_addr TEXT NOT NULL DEFAULT '',
    to_json TEXT NOT NULL DEFAULT '[]',
    cc_json TEXT NOT NULL DEFAULT '[]',
    reply_to_json TEXT NOT NULL DEFAULT '[]',
    date INTEGER NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    unread INTEGER NOT NULL DEFAULT 1,
    flagged INTEGER NOT NULL DEFAULT 0,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    body_html TEXT,
    body_text TEXT,
    attachments_json TEXT,
    eml_path TEXT
  );
  CREATE INDEX messages_folder_date ON messages (folder_id, date DESC);
  CREATE INDEX messages_thread ON messages (account_id, thread_id);
  CREATE INDEX messages_msgid ON messages (account_id, message_id_header);

  CREATE VIRTUAL TABLE messages_fts USING fts5 (
    subject, sender, recipients, body,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, subject, sender, recipients, body)
    VALUES (new.rowid, new.subject, new.from_name || ' ' || new.from_addr, new.to_json || ' ' || new.cc_json,
            coalesce(new.body_text, new.snippet));
  END;
  CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
  END;
  CREATE TRIGGER messages_au AFTER UPDATE OF subject, snippet, body_text ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
    INSERT INTO messages_fts (rowid, subject, sender, recipients, body)
    VALUES (new.rowid, new.subject, new.from_name || ' ' || new.from_addr, new.to_json || ' ' || new.cc_json,
            coalesce(new.body_text, new.snippet));
  END;

  CREATE TABLE calendars (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    remote_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    read_only INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    UNIQUE (account_id, remote_id)
  );

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    remote_id TEXT NOT NULL,
    etag TEXT,
    ical TEXT,
    title TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    recurring INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX events_range ON events (start, end);
  `,
  // Drafts keep their Bcc so it survives reopening.
  `ALTER TABLE messages ADD COLUMN bcc_json TEXT NOT NULL DEFAULT '[]';`,
  // Calendars get their own sources (Google, CalDAV, ICS), independent from mail accounts.
  // Calendar data is only a cache, so the old tables are simply rebuilt.
  `
  DROP TABLE events;
  DROP TABLE calendars;

  CREATE TABLE cal_sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
    url TEXT,
    username TEXT,
    secret BLOB,
    sync_error TEXT,
    last_sync_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE calendars (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES cal_sources(id) ON DELETE CASCADE,
    remote_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    user_color TEXT,
    read_only INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    default_reminders TEXT NOT NULL DEFAULT '[]',
    UNIQUE (source_id, remote_id)
  );

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES cal_sources(id) ON DELETE CASCADE,
    remote_id TEXT NOT NULL,
    etag TEXT,
    ical TEXT,
    title TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    recurring INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'confirmed',
    meeting_url TEXT,
    meeting_provider TEXT,
    attendees_json TEXT NOT NULL DEFAULT '[]',
    organizer TEXT,
    my_status TEXT,
    reminders_json TEXT,
    web_link TEXT
  );
  CREATE INDEX events_range ON events (start, end);

  CREATE TABLE reminders_fired (
    key TEXT PRIMARY KEY,
    fired_at INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Smart inbox: category + the raw signals it was derived from (so rules can re-sort offline),
  // per-account and per-calendar preferences, user rules. Folders are reset so the next sync
  // re-reads the newly needed headers.
  `
  ALTER TABLE messages ADD COLUMN category TEXT NOT NULL DEFAULT 'people';
  ALTER TABLE messages ADD COLUMN signals TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE messages ADD COLUMN list_unsubscribe TEXT;
  CREATE INDEX messages_category ON messages (category);
  UPDATE folders SET uidvalidity = NULL;

  ALTER TABLE accounts ADD COLUMN notify INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE accounts ADD COLUMN in_unified INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE accounts ADD COLUMN sync_depth INTEGER NOT NULL DEFAULT 400;

  ALTER TABLE calendars ADD COLUMN notify INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE calendars ADD COLUMN reminder_override INTEGER;

  CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  `,
  `ALTER TABLE accounts ADD COLUMN label TEXT NOT NULL DEFAULT '';`,
  // Changes made offline, replayed in order once the server is reachable again.
  `
  CREATE TABLE pending_ops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_error TEXT
  );
  `,
  // Reusable messages per account, with {{fields}} filled in when used.
  `
  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL DEFAULT '',
    to_json TEXT NOT NULL DEFAULT '[]',
    cc_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX templates_account ON templates(account_id);
  `,
  // Folder tree (parent on the server) and folders pinned to the top of the sidebar.
  `
  ALTER TABLE folders ADD COLUMN parent_path TEXT;
  ALTER TABLE folders ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
  `
]

function migrate(d: DatabaseSync): void {
  const row = d.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    d.exec('BEGIN')
    try {
      d.exec(MIGRATIONS[v])
      d.exec(`PRAGMA user_version = ${v + 1}`)
      d.exec('COMMIT')
    } catch (err) {
      d.exec('ROLLBACK')
      throw err
    }
  }
}

export function tx<T>(fn: () => T): T {
  const d = getDb()
  d.exec('BEGIN')
  try {
    const out = fn()
    d.exec('COMMIT')
    return out
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}
