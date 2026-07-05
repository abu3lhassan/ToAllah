-- Migration 019: Track plan origin on managed_khatmas for plan-based apply.
-- Safe: additive only. No INSERT/UPDATE/DELETE. No column drops.

ALTER TABLE managed_khatmas ADD COLUMN plan_id TEXT;
ALTER TABLE managed_khatmas ADD COLUMN applied_cycle INTEGER;

-- Fast lookup: which khatmas came from a plan
CREATE INDEX IF NOT EXISTS idx_mk_plan_id
ON managed_khatmas(plan_id)
WHERE plan_id IS NOT NULL;

-- Guard: one surviving khatma per (plan, cycle). Prevents double-apply race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mk_plan_cycle
ON managed_khatmas(plan_id, applied_cycle)
WHERE plan_id IS NOT NULL
  AND applied_cycle IS NOT NULL
  AND deleted_at IS NULL;
