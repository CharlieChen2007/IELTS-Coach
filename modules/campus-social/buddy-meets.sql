CREATE TABLE IF NOT EXISTS social_buddy_meets (
  id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, proposer TEXT NOT NULL,
  task TEXT NOT NULL, start INTEGER NOT NULL, created INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','confirmed','cancelled','done')),
  note_a TEXT NOT NULL DEFAULT '', note_b TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (a,b) REFERENCES social_invites(a,b)
);
CREATE UNIQUE INDEX IF NOT EXISTS buddy_one_open_meet ON social_buddy_meets(a,b) WHERE state IN ('pending','confirmed');
CREATE INDEX IF NOT EXISTS buddy_recent_meets ON social_buddy_meets(a,b,created DESC);
