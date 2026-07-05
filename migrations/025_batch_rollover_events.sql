-- Migration 025: ToAllah-native batch monthly rollover event log.
-- Each row records one completed batch rollover for a khatma in a given target month.
-- UNIQUE(khatma_id, target_year_month) is the primary double-rollover guard.
-- Separate from managed_rollover_plan_events (which has plan_id NOT NULL).

CREATE TABLE IF NOT EXISTS managed_batch_rollover_events (
  id                  TEXT    PRIMARY KEY,
  khatma_id           TEXT    NOT NULL,
  group_id            TEXT,
  target_year_month   TEXT    NOT NULL,
  period_number_before INTEGER,
  period_number_after  INTEGER,
  algorithm           TEXT    NOT NULL,
  assignments_created INTEGER DEFAULT 0,
  readers_count       INTEGER DEFAULT 0,
  applied_by_user_id  TEXT,
  event_payload_json  TEXT,
  created_at          TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brev_khatma_month
ON managed_batch_rollover_events(khatma_id, target_year_month);

CREATE INDEX IF NOT EXISTS idx_brev_month_created
ON managed_batch_rollover_events(target_year_month, created_at);

CREATE INDEX IF NOT EXISTS idx_brev_khatma_created
ON managed_batch_rollover_events(khatma_id, created_at);
