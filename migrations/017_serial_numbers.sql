-- Migration 017: Serial numbers for khatmas and reader groups
-- Adds khatma_serial_number (K-000001) and group_serial_number (G-000001).
-- System-generated only; never editable by users or API.

ALTER TABLE managed_khatmas ADD COLUMN khatma_serial_number TEXT;
ALTER TABLE managed_reader_groups ADD COLUMN group_serial_number TEXT;

-- Unique partial indexes (NULL rows excluded to allow pre-backfill state)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mk_serial_number
  ON managed_khatmas(khatma_serial_number)
  WHERE khatma_serial_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mrg_serial_number
  ON managed_reader_groups(group_serial_number)
  WHERE group_serial_number IS NOT NULL;

-- Backfill existing khatmas ordered by creation time then id (stable, repeatable)
UPDATE managed_khatmas SET khatma_serial_number = (
  SELECT 'K-' || SUBSTR('000000' || rn, -6)
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
    FROM managed_khatmas
    WHERE deleted_at IS NULL
  ) sub
  WHERE sub.id = managed_khatmas.id
)
WHERE deleted_at IS NULL;

-- Backfill existing groups ordered by creation time then id
UPDATE managed_reader_groups SET group_serial_number = (
  SELECT 'G-' || SUBSTR('000000' || rn, -6)
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
    FROM managed_reader_groups
    WHERE status != 'deleted'
  ) sub
  WHERE sub.id = managed_reader_groups.id
)
WHERE status != 'deleted';
