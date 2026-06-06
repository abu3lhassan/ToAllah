-- Safe one-time D1 migration for coordinator contact fields.
-- Do NOT run schema.sql for this patch.
ALTER TABLE khatmas ADD COLUMN coordinator_name TEXT NOT NULL DEFAULT '';
ALTER TABLE khatmas ADD COLUMN coordinator_whatsapp TEXT NOT NULL DEFAULT '';
