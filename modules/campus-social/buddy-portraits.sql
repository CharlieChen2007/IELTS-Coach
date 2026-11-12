CREATE TABLE IF NOT EXISTS social_buddy_portraits (
 member TEXT PRIMARY KEY REFERENCES social_members(id),
 answers TEXT NOT NULL,
 updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_buddy_post_preferences (
 member TEXT PRIMARY KEY REFERENCES social_buddy_posts(member) ON DELETE CASCADE,
 subjects TEXT NOT NULL
);
