-- Add configurable khatma type for managed share messages.
-- Normal khatmas already define khatma_type in 0001_init.sql.

ALTER TABLE managed_khatmas ADD COLUMN khatma_type TEXT NOT NULL DEFAULT 'monthly';
