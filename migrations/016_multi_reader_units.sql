CREATE TABLE managed_khatma_units_new (
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
  FOREIGN KEY (participant_id) REFERENCES managed_khatma_participants(id) ON DELETE SET NULL
);

INSERT INTO managed_khatma_units_new (
  id,
  khatma_id,
  unit_number,
  label,
  status,
  participant_id,
  reading_at,
  completed_at,
  updated_at
)
SELECT
  id,
  khatma_id,
  unit_number,
  label,
  status,
  participant_id,
  reading_at,
  completed_at,
  updated_at
FROM managed_khatma_units;

DROP TABLE managed_khatma_units;

ALTER TABLE managed_khatma_units_new
RENAME TO managed_khatma_units;

CREATE INDEX IF NOT EXISTS idx_units_khatma_unit_participant
ON managed_khatma_units(khatma_id, unit_number, participant_id);

CREATE INDEX IF NOT EXISTS idx_units_participant_status
ON managed_khatma_units(participant_id, status);