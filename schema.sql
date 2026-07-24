CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  time_zone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY DEFAULT 'shared',
  my_name TEXT,
  partner_name TEXT,
  my_time_zone TEXT,
  partner_time_zone TEXT,
  relationship_start TEXT,
  pair_code TEXT,
  version INTEGER DEFAULT 1,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL DEFAULT 'me',
  owner_user_id TEXT,
  title TEXT,
  start_utc TEXT,
  end_utc TEXT,
  source_time_zone TEXT,
  location TEXT,
  notes TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL DEFAULT 'me',
  owner_user_id TEXT,
  title TEXT,
  weekday INTEGER,
  start TEXT,
  end TEXT,
  time_zone TEXT,
  location TEXT,
  teacher TEXT,
  color TEXT,
  term_start TEXT,
  term_end TEXT,
  weeks TEXT,
  week_parity TEXT DEFAULT 'all',
  excluded_dates TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS anniversaries (
  id TEXT PRIMARY KEY,
  title TEXT,
  date TEXT,
  repeat_annually INTEGER DEFAULT 0,
  kind TEXT DEFAULT 'custom',
  note TEXT,
  color TEXT,
  meeting_status TEXT,
  meeting_location TEXT,
  meeting_proposed_by TEXT,
  meeting_confirmed_by TEXT,
  meeting_confirmed_at TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  date TEXT,
  title TEXT,
  note TEXT,
  mood TEXT,
  anniversary_id TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  created_by TEXT
);
