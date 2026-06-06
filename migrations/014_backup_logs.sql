CREATE TABLE IF NOT EXISTS backup_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL
);
