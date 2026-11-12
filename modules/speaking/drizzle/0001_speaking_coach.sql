CREATE TABLE speaking_practice (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, ended_at INTEGER NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY(owner_id,id)
);
--> statement-breakpoint
CREATE INDEX speaking_practice_recent ON speaking_practice(owner_id,ended_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE speaking_reports (
  owner_id TEXT NOT NULL, session_id TEXT NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY(owner_id,session_id)
);
--> statement-breakpoint
CREATE TABLE speaking_model_usage (
  owner_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL,
  PRIMARY KEY(owner_id,day)
);
