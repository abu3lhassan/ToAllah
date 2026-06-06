CREATE TABLE IF NOT EXISTS khatma_templates (
  id TEXT PRIMARY KEY,
  created_by_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_khatma_templates_created_by
ON khatma_templates(created_by_user_id, updated_at);
