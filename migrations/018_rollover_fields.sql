-- Migration 018: Add rollover chain fields to managed_khatmas
-- parent_khatma_id: links a new khatma to the one it was rolled over from
-- period_number: 1 for original, 2 for first rollover, etc.
-- Safe: ADD COLUMN only, no drops.
ALTER TABLE managed_khatmas ADD COLUMN parent_khatma_id TEXT;
ALTER TABLE managed_khatmas ADD COLUMN period_number INTEGER DEFAULT 1;
