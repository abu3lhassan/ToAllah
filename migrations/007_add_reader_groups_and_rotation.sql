-- Migration 007: Add reader groups and rotation support for managed khatmas
-- Safe: only adds new tables/columns, no drops or destructive changes

CREATE TABLE IF NOT EXISTS managed_reader_groups (
  id TEXT PRIMARY KEY,
  created_by_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  notes TEXT,
  rotation_type TEXT NOT NULL DEFAULT 'monthly',
  rotation_start_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  shared_creator_group_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_managed_groups_created_by ON managed_reader_groups(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_managed_groups_status ON managed_reader_groups(status);

-- Add group_id and rotation fields to reader profiles
ALTER TABLE managed_reader_profiles ADD COLUMN group_id TEXT;
ALTER TABLE managed_reader_profiles ADD COLUMN start_juz INTEGER;
ALTER TABLE managed_reader_profiles ADD COLUMN parts_count INTEGER;

-- Add group_id and rotation_start_date to managed khatmas
ALTER TABLE managed_khatmas ADD COLUMN group_id TEXT;
ALTER TABLE managed_khatmas ADD COLUMN rotation_start_date TEXT;

-- Add rotation fields to khatma participants
ALTER TABLE managed_khatma_participants ADD COLUMN start_juz INTEGER;
ALTER TABLE managed_khatma_participants ADD COLUMN parts_count INTEGER;
