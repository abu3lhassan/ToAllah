-- Migration 028: Backfill managed_reader_group_memberships from the existing
-- single-value managed_reader_profiles.group_id column.
-- Safe: additive INSERT only, uses INSERT OR IGNORE against the
-- UNIQUE(reader_profile_id, group_id) constraint so it is safe to re-run.
-- managed_reader_profiles.group_id is left untouched — it keeps working as a
-- fallback for any code path not yet updated to read from memberships.

INSERT OR IGNORE INTO managed_reader_group_memberships
  (id, reader_profile_id, group_id, status, role, created_at, created_by)
SELECT
  'rgm_backfill_' || mrp.id,
  mrp.id,
  mrp.group_id,
  'active',
  'member',
  COALESCE(mrp.updated_at, mrp.created_at),
  mrp.created_by_user_id
FROM managed_reader_profiles mrp
WHERE mrp.group_id IS NOT NULL
  AND mrp.group_id != ''
  AND mrp.status != 'deleted';
