-- Migration 011: Add current_period_index for auto-rotation tracking
ALTER TABLE managed_khatmas ADD COLUMN current_period_index INTEGER DEFAULT 0;
