CREATE TABLE IF NOT EXISTS reading_attempts (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  passage TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, id)
);
