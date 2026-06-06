-- Managed reader profiles: reusable readers owned by each managed khatma creator.

CREATE TABLE IF NOT EXISTS managed_reader_profiles (
  id TEXT PRIMARY KEY,
  created_by_user_id TEXT NOT NULL,
  reader_name TEXT NOT NULL,
  phone TEXT,
  access_code TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  shared_creator_group_id TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(created_by_user_id, access_code)
);

CREATE INDEX IF NOT EXISTS idx_managed_readers_created_by ON managed_reader_profiles(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_managed_readers_status ON managed_reader_profiles(status);

ALTER TABLE managed_khatma_participants ADD COLUMN reader_profile_id TEXT;
CREATE INDEX IF NOT EXISTS idx_managed_participants_reader ON managed_khatma_participants(reader_profile_id);
