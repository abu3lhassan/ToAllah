-- Migration 027: Many-to-many reader <-> group memberships.
-- managed_reader_profiles.group_id (added in migration 007) only allows a
-- reader to belong to a single group. A reader who legitimately participates
-- in more than one group/khatma set needs multiple memberships without being
-- duplicated as a separate profile.
-- Safe: additive only. group_id on managed_reader_profiles is NOT dropped —
-- it stays as a fallback for any code path not yet migrated to memberships.

CREATE TABLE IF NOT EXISTS managed_reader_group_memberships (
  id TEXT PRIMARY KEY,
  reader_profile_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE(reader_profile_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_rgm_reader
  ON managed_reader_group_memberships(reader_profile_id);

CREATE INDEX IF NOT EXISTS idx_rgm_group
  ON managed_reader_group_memberships(group_id, status);
