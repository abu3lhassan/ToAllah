-- Migration 010: Creator groups for shared managed khatma visibility

CREATE TABLE IF NOT EXISTS managed_creator_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  created_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS managed_creator_group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_groups_owner ON managed_creator_groups(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_creator_group_members_group ON managed_creator_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_creator_group_members_user ON managed_creator_group_members(user_id);
