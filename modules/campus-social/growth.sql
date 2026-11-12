CREATE TABLE IF NOT EXISTS camp_growth_events (
 school TEXT NOT NULL, member TEXT NOT NULL, event TEXT NOT NULL, kind TEXT NOT NULL,
 units INTEGER NOT NULL, item TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL,
 PRIMARY KEY (school,member,event)
);
CREATE INDEX IF NOT EXISTS growth_totals ON camp_growth_events(school,kind,member);
CREATE TABLE IF NOT EXISTS camp_exam_fields (
 school TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, author TEXT NOT NULL,
 updated INTEGER NOT NULL, PRIMARY KEY(school,field)
);
CREATE TABLE IF NOT EXISTS camp_exam_contributors (
 school TEXT NOT NULL, member TEXT NOT NULL, PRIMARY KEY(school,member)
);
CREATE TABLE IF NOT EXISTS camp_exam_edits (
 school TEXT NOT NULL, member TEXT NOT NULL, id TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(school,member,id)
);
CREATE TABLE IF NOT EXISTS camp_stories (
 school TEXT NOT NULL, id TEXT NOT NULL, member TEXT NOT NULL, nickname TEXT NOT NULL,
 band REAL NOT NULL, days INTEGER NOT NULL, headline TEXT NOT NULL, body TEXT NOT NULL,
 created INTEGER NOT NULL, PRIMARY KEY(school,id)
);
CREATE TABLE IF NOT EXISTS camp_story_likes (
 school TEXT NOT NULL, story TEXT NOT NULL, member TEXT NOT NULL, PRIMARY KEY(school,story,member),
 FOREIGN KEY(school,story) REFERENCES camp_stories(school,id)
);
CREATE TRIGGER IF NOT EXISTS growth_record_invite AFTER UPDATE OF status ON social_invites
WHEN OLD.status='pending' AND NEW.status IN ('declined','accepted')
BEGIN
 INSERT OR IGNORE INTO camp_growth_events(school,member,event,kind,units,item,created)
 SELECT school,id,'invite:'||NEW.a||':'||NEW.b||':'||OLD.created,'invite',0,NEW.status,NEW.created
 FROM social_members WHERE id=CASE WHEN NEW.sender=NEW.a THEN NEW.b ELSE NEW.a END;
END;

