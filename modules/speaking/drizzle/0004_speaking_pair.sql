CREATE TABLE campus_speaking_pairs (
  code TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  host_name TEXT NOT NULL,
  guest TEXT,
  guest_name TEXT,
  quick INTEGER NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  waiting_seen_at INTEGER NOT NULL,
  completed_at INTEGER,
  credited INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX campus_speaking_pairs_host ON campus_speaking_pairs(host,updated_at DESC);
--> statement-breakpoint
CREATE INDEX campus_speaking_pairs_guest ON campus_speaking_pairs(guest,updated_at DESC);
--> statement-breakpoint
CREATE INDEX campus_speaking_pairs_wait ON campus_speaking_pairs(status,quick,waiting_seen_at);
