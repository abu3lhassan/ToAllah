-- 015_add_reader_registry_fields.sql
-- Adds serial_code (auto-generated, unique, immutable) and country
-- to the global reader registry.
-- Both columns are nullable TEXT so existing rows are unaffected
-- until the backfill step at the bottom runs.

ALTER TABLE managed_reader_profiles ADD COLUMN serial_code TEXT;
ALTER TABLE managed_reader_profiles ADD COLUMN country TEXT;

-- Unique index: enforces uniqueness, skips NULL rows (pre-backfill safety).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mrp_serial_code
  ON managed_reader_profiles(serial_code)
  WHERE serial_code IS NOT NULL;

-- Backfill: assign R-000001, R-000002, ... to every existing active reader
-- ordered by created_at ASC, then id ASC (breaks ties when timestamps match).
-- The correlated subquery counts rows that sort strictly before each row,
-- producing a unique sequential position without window functions in UPDATE.
UPDATE managed_reader_profiles
SET serial_code = 'R-' || PRINTF('%06d', (
  SELECT COUNT(*) + 1
  FROM managed_reader_profiles AS m2
  WHERE m2.status != 'deleted'
    AND (
      m2.created_at < managed_reader_profiles.created_at
      OR (  m2.created_at  = managed_reader_profiles.created_at
        AND m2.id          < managed_reader_profiles.id )
    )
))
WHERE serial_code IS NULL AND status != 'deleted';
