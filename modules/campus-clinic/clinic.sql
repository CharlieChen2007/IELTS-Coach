CREATE TABLE IF NOT EXISTS clinic_cases (
 id TEXT PRIMARY KEY, school TEXT NOT NULL, owner TEXT NOT NULL, owner_name TEXT NOT NULL,
 visibility TEXT NOT NULL CHECK(visibility IN ('school','private')), subject TEXT NOT NULL,
 source_id TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL, original TEXT NOT NULL,
 issues TEXT NOT NULL, note TEXT NOT NULL, attachment TEXT,
 helper TEXT, helper_name TEXT, reply TEXT, revised TEXT, resolved INTEGER NOT NULL DEFAULT 0,
 created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS clinic_board ON clinic_cases(school, updated DESC);
CREATE TABLE IF NOT EXISTS clinic_slots (
 id TEXT PRIMARY KEY, school TEXT NOT NULL, mentor TEXT NOT NULL, mentor_name TEXT NOT NULL,
 subject TEXT NOT NULL, focus TEXT NOT NULL, start INTEGER NOT NULL, UNIQUE(mentor,start)
);
CREATE TABLE IF NOT EXISTS clinic_visits (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES clinic_cases(id), slot_id TEXT NOT NULL REFERENCES clinic_slots(id),
 learner TEXT NOT NULL, mentor TEXT NOT NULL, start INTEGER NOT NULL, issues TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'booked', advice TEXT, created INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS clinic_slot_booked ON clinic_visits(slot_id) WHERE state <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS clinic_open_visit ON clinic_visits(case_id) WHERE state <> 'cancelled';
CREATE INDEX IF NOT EXISTS clinic_mentor ON clinic_visits(mentor,start);
CREATE TRIGGER IF NOT EXISTS clinic_busy BEFORE INSERT ON clinic_visits
WHEN EXISTS (SELECT 1 FROM clinic_visits v WHERE v.start=NEW.start AND v.state <> 'cancelled'
 AND (v.learner IN (NEW.learner,NEW.mentor) OR v.mentor IN (NEW.learner,NEW.mentor)))
BEGIN SELECT RAISE(ABORT,'clinic time busy'); END;
