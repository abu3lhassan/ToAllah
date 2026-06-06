DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS khatma_units;
DROP TABLE IF EXISTS khatmas;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'creator',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE khatmas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  week_number TEXT,
  khatma_type TEXT NOT NULL DEFAULT 'monthly',
  khatma_date TEXT,
  hijri_date TEXT,
  gregorian_date TEXT,
  expires_at TEXT,
  division TEXT NOT NULL DEFAULT 'juz',
  selection_mode TEXT NOT NULL DEFAULT 'all',
  owner_name TEXT,
  owner_key TEXT NOT NULL,
  created_by_user_id TEXT,
  dedication TEXT,
  quote_by TEXT,
  quote_text TEXT,
  quote_source TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  admin_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE khatma_units (
  id TEXT PRIMARY KEY,
  khatma_id TEXT NOT NULL,
  unit_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  participant_name TEXT,
  reserved_at TEXT,
  reading_at TEXT,
  completed_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (khatma_id) REFERENCES khatmas(id) ON DELETE CASCADE,
  UNIQUE(khatma_id, unit_number)
);


CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_khatmas_owner_key ON khatmas(owner_key);
CREATE INDEX IF NOT EXISTS idx_khatmas_created_by ON khatmas(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_khatmas_deleted_at ON khatmas(deleted_at);
CREATE INDEX IF NOT EXISTS idx_units_khatma ON khatma_units(khatma_id, unit_number);
CREATE INDEX IF NOT EXISTS idx_units_status ON khatma_units(status);

CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempted_at);

-- تنبيه: لا تضع بيانات المستخدمين هنا - يجب إنشاء المالك عبر:
-- npx wrangler d1 execute khatmat_darb_alzahra --remote --command="INSERT INTO users ..."
