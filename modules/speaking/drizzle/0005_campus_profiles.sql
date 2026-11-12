CREATE TABLE IF NOT EXISTS campus_profiles (
  user_id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS campus_solo_sessions (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY(user_id, task_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS campus_solo_answers (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  answer_id TEXT NOT NULL,
  PRIMARY KEY(user_id, task_id, answer_id)
);
