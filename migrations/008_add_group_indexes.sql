-- Migration 008: Add indexes for group_id columns and fix missing indexes
-- Safe: CREATE INDEX IF NOT EXISTS

CREATE INDEX IF NOT EXISTS idx_managed_khatmas_group ON managed_khatmas(group_id);
CREATE INDEX IF NOT EXISTS idx_managed_readers_group ON managed_reader_profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_managed_participants_access_code ON managed_khatma_participants(khatma_id, access_code);
