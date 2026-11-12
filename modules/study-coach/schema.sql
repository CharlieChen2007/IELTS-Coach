CREATE TABLE IF NOT EXISTS study_coach_analyses (
  owner_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  version TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id, subject, attempt_id, version)
);
CREATE TABLE IF NOT EXISTS study_coach_usage (
  owner_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
  PRIMARY KEY(owner_id, day)
);
