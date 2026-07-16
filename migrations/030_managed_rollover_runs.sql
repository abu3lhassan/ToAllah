-- Migration 030: Resumable Rollover Run system.
-- Separates "discover eligible khatmas" (once, at run creation) from
-- "process one khatma" (many small, resumable steps). This fixes the root
-- cause of the Cloudflare 1102 incident during the 1448-02 rollover, where
-- every single-khatma request re-scanned the ENTIRE eligible-khatma
-- candidate list twice (once before processing, once after) just to
-- find/confirm one item.
-- No change to period_shift_v1 rollover logic itself; this only changes how
-- work is queued and resumed. Additive only, no FOREIGN KEY (matches the
-- managed_* convention since migration 004).

CREATE TABLE IF NOT EXISTS managed_rollover_runs (
  id                      TEXT    PRIMARY KEY,
  target_year_month       TEXT    NOT NULL,
  status                  TEXT    NOT NULL DEFAULT 'running',  -- building|running|paused|completed|failed|cancelled
  algorithm               TEXT    NOT NULL DEFAULT 'period_shift_v1',
  scope_group_ids_json    TEXT,
  total_items             INTEGER NOT NULL DEFAULT 0,
  pending_count           INTEGER NOT NULL DEFAULT 0,
  done_count              INTEGER NOT NULL DEFAULT 0,
  failed_count            INTEGER NOT NULL DEFAULT 0,
  skipped_count           INTEGER NOT NULL DEFAULT 0,
  created_by_user_id      TEXT    NOT NULL,
  created_at              TEXT    NOT NULL,
  updated_at              TEXT    NOT NULL,
  completed_at            TEXT,
  last_error              TEXT
);

-- Authoritative concurrency guard: at most one run in an active state
-- (running/paused) per target_year_month. SQLite (and D1, which is built on
-- it) supports partial unique indexes, so this is enforced at the database
-- level, not just by an application-level pre-check, which is race-prone
-- under concurrent requests. The application still does a pre-check first
-- (for a friendly error message) but relies on this index as the real guard:
-- a second concurrent INSERT or UPDATE is rejected by SQLite itself.
-- A run starts in status 'building' (deliberately NOT covered by this index)
-- while its run_items are being inserted, and only moves to 'running' (or
-- straight to 'completed' if there is nothing to do) once that succeeds; if
-- item insertion fails, the run moves to 'failed' instead of ever occupying
-- the one-active-run-per-month slot. building and failed runs are never
-- accepted by the /step endpoint (it requires status = 'running').
CREATE UNIQUE INDEX IF NOT EXISTS idx_mrruns_one_active_month
ON managed_rollover_runs(target_year_month)
WHERE status IN ('running', 'paused');

CREATE INDEX IF NOT EXISTS idx_mrruns_month_status
ON managed_rollover_runs(target_year_month, status);

CREATE TABLE IF NOT EXISTS managed_rollover_run_items (
  id                      TEXT    PRIMARY KEY,
  run_id                  TEXT    NOT NULL,
  khatma_id               TEXT    NOT NULL,
  group_id                TEXT,
  status                  TEXT    NOT NULL DEFAULT 'pending',  -- pending|running|done|failed|skipped
  attempt_count           INTEGER NOT NULL DEFAULT 0,
  sequence_number         INTEGER NOT NULL DEFAULT 0,
  period_number_before    INTEGER,
  period_number_after     INTEGER,
  assignments_created     INTEGER,
  readers_count           INTEGER,
  last_error              TEXT,
  started_at              TEXT,
  processed_at            TEXT,
  created_at              TEXT    NOT NULL,
  UNIQUE(run_id, khatma_id)
);

CREATE INDEX IF NOT EXISTS idx_mrritems_run_status
ON managed_rollover_run_items(run_id, status);

CREATE INDEX IF NOT EXISTS idx_mrritems_run_sequence
ON managed_rollover_run_items(run_id, sequence_number);
