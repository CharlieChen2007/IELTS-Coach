CREATE TABLE IF NOT EXISTS social_members (
 id TEXT PRIMARY KEY, school TEXT NOT NULL, nickname TEXT NOT NULL, level REAL NOT NULL, target REAL NOT NULL,
 strong TEXT NOT NULL, need TEXT NOT NULL, slots TEXT NOT NULL, verified_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_points (
 id INTEGER PRIMARY KEY, member TEXT NOT NULL REFERENCES social_members(id), subject TEXT NOT NULL,
 event TEXT NOT NULL, label TEXT NOT NULL, points INTEGER NOT NULL, category TEXT NOT NULL, created INTEGER NOT NULL,
 UNIQUE(member,event)
);
CREATE INDEX IF NOT EXISTS social_points_week ON social_points(created,member,subject);
CREATE TABLE IF NOT EXISTS social_evidence (
 member TEXT NOT NULL, event TEXT NOT NULL, report TEXT NOT NULL, question TEXT NOT NULL,
 before_text TEXT NOT NULL, after_text TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(member,event),
 FOREIGN KEY(member,event) REFERENCES social_points(member,event)
);
CREATE TABLE IF NOT EXISTS social_invites (
 a TEXT NOT NULL REFERENCES social_members(id), b TEXT NOT NULL REFERENCES social_members(id),
 sender TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(a,b)
);
CREATE TABLE IF NOT EXISTS social_squads (
 id TEXT PRIMARY KEY, school TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_roster (
 member TEXT PRIMARY KEY REFERENCES social_members(id), team TEXT NOT NULL REFERENCES social_squads(id), joined INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_oral_retry (
 member TEXT NOT NULL, source TEXT NOT NULL, started INTEGER NOT NULL,
 completed TEXT, PRIMARY KEY(member,source), UNIQUE(member,completed)
);
-- Practice credits and the existing exam-month study group's weekly totals commit together.
-- Speaking sessions already publish their own verified completion through the recording engine.
CREATE TRIGGER IF NOT EXISTS social_practice_group_progress AFTER INSERT ON social_points
WHEN NEW.category='practice' AND NEW.subject IN ('listening','reading','writing')
BEGIN
 INSERT OR IGNORE INTO campus_team_completions(user_id,skill,completion_id,team_id,week,completed_at)
 VALUES(NEW.member,NEW.subject,'social:'||NEW.event,
   (SELECT team_id FROM campus_team_members WHERE user_id=NEW.member AND joined_at<=NEW.created),
   date(NEW.created/1000,'unixepoch','+8 hours','-6 days','weekday 1'),NEW.created);
END;
