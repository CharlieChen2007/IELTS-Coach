CREATE TABLE IF NOT EXISTS social_buddy_posts (
 member TEXT PRIMARY KEY REFERENCES social_members(id),
 subject TEXT NOT NULL, message TEXT NOT NULL, free_slot TEXT NOT NULL,
 target REAL NOT NULL, gift TEXT NOT NULL, report_summary TEXT NOT NULL DEFAULT '',
 updated INTEGER NOT NULL
);
