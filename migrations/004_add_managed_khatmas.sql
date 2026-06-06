-- Managed khatmas: separate feature tables and permissions.
-- Safe one-time D1 migration. Does not alter existing khatma tables.

CREATE TABLE IF NOT EXISTS managed_khatma_permissions (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS managed_khatmas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  week_number TEXT,
  khatma_date TEXT,
  hijri_date TEXT,
  gregorian_date TEXT,
  expires_at TEXT,
  division TEXT NOT NULL DEFAULT 'juz',
  selection_mode TEXT NOT NULL DEFAULT 'all',
  owner_name TEXT,
  created_by_user_id TEXT NOT NULL,
  coordinator_name TEXT,
  coordinator_whatsapp TEXT,
  dedication TEXT,
  quote_by TEXT,
  quote_text TEXT,
  quote_source TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  closed_at TEXT,
  deleted_at TEXT,
  shared_creator_group_id TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS managed_khatma_participants (
  id TEXT PRIMARY KEY,
  khatma_id TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  phone TEXT,
  access_code TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (khatma_id) REFERENCES managed_khatmas(id) ON DELETE CASCADE,
  UNIQUE(khatma_id, access_code)
);

CREATE TABLE IF NOT EXISTS managed_khatma_units (
  id TEXT PRIMARY KEY,
  khatma_id TEXT NOT NULL,
  unit_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  participant_id TEXT,
  reading_at TEXT,
  completed_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (khatma_id) REFERENCES managed_khatmas(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES managed_khatma_participants(id) ON DELETE SET NULL,
  UNIQUE(khatma_id, unit_number)
);

CREATE INDEX IF NOT EXISTS idx_managed_permissions_status ON managed_khatma_permissions(status);
CREATE INDEX IF NOT EXISTS idx_managed_khatmas_created_by ON managed_khatmas(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_managed_khatmas_deleted_at ON managed_khatmas(deleted_at);
CREATE INDEX IF NOT EXISTS idx_managed_participants_khatma ON managed_khatma_participants(khatma_id);
CREATE INDEX IF NOT EXISTS idx_managed_units_khatma ON managed_khatma_units(khatma_id, unit_number);
CREATE INDEX IF NOT EXISTS idx_managed_units_status ON managed_khatma_units(status);
