-- Migration 024: Option A history model — unit-level snapshots per closed cycle.
-- Fully denormalized: managed_khatma_participants is deleted and rebuilt at every cycle apply.
-- Multi-reader: one snapshot row per source unit row (multiple rows per unit_number allowed).
-- Safe: additive only.

CREATE TABLE IF NOT EXISTS managed_khatma_cycle_units (
  id                     TEXT    PRIMARY KEY,

  cycle_snapshot_id      TEXT    NOT NULL,

  khatma_id              TEXT    NOT NULL,
  cycle_number           INTEGER NOT NULL,

  unit_number            INTEGER NOT NULL CHECK(unit_number >= 1 AND unit_number <= 30),
  label                  TEXT    NOT NULL DEFAULT '',

  slot_index             INTEGER,

  participant_id_snap    TEXT,
  participant_name       TEXT,
  participant_access_code TEXT,

  reader_profile_id      TEXT,
  reader_name            TEXT,
  reader_access_code     TEXT,

  status                 TEXT    NOT NULL DEFAULT 'assigned',
  reading_at             TEXT,
  completed_at           TEXT,

  parts_count            INTEGER,

  source_plan_id         TEXT,

  created_at             TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kcunit_khatma_cycle
  ON managed_khatma_cycle_units(khatma_id, cycle_number);

CREATE INDEX IF NOT EXISTS idx_kcunit_reader_profile
  ON managed_khatma_cycle_units(reader_profile_id)
  WHERE reader_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kcunit_reader_completed
  ON managed_khatma_cycle_units(reader_profile_id, status, completed_at)
  WHERE reader_profile_id IS NOT NULL AND status = 'completed';

CREATE INDEX IF NOT EXISTS idx_kcunit_snapshot_id
  ON managed_khatma_cycle_units(cycle_snapshot_id);

CREATE INDEX IF NOT EXISTS idx_kcunit_source_plan
  ON managed_khatma_cycle_units(source_plan_id)
  WHERE source_plan_id IS NOT NULL;
