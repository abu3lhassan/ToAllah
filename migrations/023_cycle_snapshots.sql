-- Migration 023: Option A history model — cycle-level snapshots per managed khatma.
-- Monthly-first for ToAllah.
-- Records one row per closed cycle at the moment a new cycle is applied.
-- Statistical contract:
--   COUNT(*) WHERE khatma_id = ?  →  statistical_khatmas_count for that K.
-- Safe: additive only.

CREATE TABLE IF NOT EXISTS managed_khatma_cycle_snapshots (
  id                   TEXT    PRIMARY KEY,

  khatma_id            TEXT    NOT NULL,
  cycle_number         INTEGER NOT NULL,
  period_number        INTEGER NOT NULL,

  plan_id              TEXT,
  khatma_type          TEXT    NOT NULL DEFAULT 'monthly',

  applied_at           TEXT    NOT NULL,
  applied_by_user_id   TEXT,

  total_units          INTEGER NOT NULL DEFAULT 30,
  completed_units      INTEGER NOT NULL DEFAULT 0,
  assigned_units       INTEGER NOT NULL DEFAULT 0,
  reading_units        INTEGER NOT NULL DEFAULT 0,

  created_at           TEXT    NOT NULL,

  UNIQUE(khatma_id, cycle_number)
);

CREATE INDEX IF NOT EXISTS idx_kcsnap_khatma
  ON managed_khatma_cycle_snapshots(khatma_id);

CREATE INDEX IF NOT EXISTS idx_kcsnap_plan
  ON managed_khatma_cycle_snapshots(plan_id)
  WHERE plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kcsnap_applied_at
  ON managed_khatma_cycle_snapshots(applied_at);
