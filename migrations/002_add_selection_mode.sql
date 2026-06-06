-- Safe one-time D1 migration for custom unit selection mode.
-- Do NOT run schema.sql for this patch.
ALTER TABLE khatmas ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'all';
