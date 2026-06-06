-- Migration 009: Rotation duration + reader portal support

ALTER TABLE managed_reader_groups ADD COLUMN rotation_duration_years INTEGER DEFAULT 5;
ALTER TABLE managed_khatmas ADD COLUMN rotation_duration_years INTEGER DEFAULT 5;
