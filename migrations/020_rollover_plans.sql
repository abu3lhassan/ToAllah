-- Migration 020: Plan-based history-aware rollover tables.
-- Monthly-first for ToAllah. Stores externally generated/imported rollover plans.
-- This migration does not apply rollover and does not modify existing khatmas.
-- Multiple readers per unit: UNIQUE(plan_id, cycle_number, unit_number) is intentionally absent.
-- Safe: additive only.

CREATE TABLE IF NOT EXISTS managed_rollover_plans (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  root_khatma_id TEXT NOT NULL,
  current_khatma_id TEXT,
  khatma_type TEXT NOT NULL DEFAULT 'monthly',
  total_cycles INTEGER NOT NULL DEFAULT 30,
  total_parts INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'draft',
  algorithm TEXT NOT NULL DEFAULT 'external_milp',
  algorithm_version TEXT NOT NULL DEFAULT '1',
  input_hash TEXT NOT NULL,
  readers_hash TEXT NOT NULL,
  history_hash TEXT NOT NULL,
  created_by_user_id TEXT,
  generated_by_user_id TEXT,
  approved_by_user_id TEXT,
  invalidated_by_user_id TEXT,
  invalidation_reason TEXT,
  generated_at TEXT,
  approved_at TEXT,
  invalidated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mrp_plans_group_status
ON managed_rollover_plans(group_id, status);

CREATE INDEX IF NOT EXISTS idx_mrp_plans_root
ON managed_rollover_plans(root_khatma_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mrp_one_active_plan
ON managed_rollover_plans(group_id, khatma_type)
WHERE status IN ('approved', 'active');

CREATE TABLE IF NOT EXISTS managed_rollover_plan_readers (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  reader_profile_id TEXT NOT NULL,
  reader_name_snapshot TEXT NOT NULL,
  phone_snapshot TEXT,
  access_code_snapshot TEXT,
  group_id_snapshot TEXT NOT NULL,
  start_juz_snapshot INTEGER,
  parts_count_snapshot INTEGER NOT NULL,
  status_snapshot TEXT NOT NULL DEFAULT 'active',
  history_parts_json TEXT NOT NULL DEFAULT '[]',
  history_unique_count INTEGER NOT NULL DEFAULT 0,
  reader_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, reader_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_mrp_plan_readers_plan
ON managed_rollover_plan_readers(plan_id);

CREATE INDEX IF NOT EXISTS idx_mrp_plan_readers_profile
ON managed_rollover_plan_readers(reader_profile_id);

-- NOTE: No UNIQUE(plan_id, cycle_number, unit_number) on assignments.
-- ToAllah supports multiple readers per juz (unit_number).
-- Each (plan_id, cycle_number, reader_profile_id, slot_index) must be unique.
CREATE TABLE IF NOT EXISTS managed_rollover_plan_assignments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  cycle_number INTEGER NOT NULL,
  planned_period_number INTEGER,
  reader_profile_id TEXT NOT NULL,
  unit_number INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  applied_khatma_id TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, cycle_number, reader_profile_id, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_mrp_assignments_plan_cycle
ON managed_rollover_plan_assignments(plan_id, cycle_number);

CREATE INDEX IF NOT EXISTS idx_mrp_assignments_reader
ON managed_rollover_plan_assignments(plan_id, reader_profile_id);

CREATE TABLE IF NOT EXISTS managed_rollover_plan_events (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mrp_events_plan
ON managed_rollover_plan_events(plan_id, created_at);
