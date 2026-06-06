-- Add configurable khatma type for normal and managed share messages.
-- Safe one-time D1 migration. Existing khatmas default to weekly.

ALTER TABLE khatmas ADD COLUMN khatma_type TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE managed_khatmas ADD COLUMN khatma_type TEXT NOT NULL DEFAULT 'weekly';
