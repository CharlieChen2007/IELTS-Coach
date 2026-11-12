CREATE TABLE campus_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  exam_month TEXT NOT NULL,
  target REAL NOT NULL,
  slots TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX campus_team_matches ON campus_teams(exam_month, target, created_at DESC);
--> statement-breakpoint
CREATE TABLE campus_team_members (
  user_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES campus_teams(id),
  nickname TEXT NOT NULL,
  joined_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX campus_team_roster ON campus_team_members(team_id, joined_at);
--> statement-breakpoint
CREATE TABLE campus_team_completions (
  user_id TEXT NOT NULL,
  skill TEXT NOT NULL CHECK(skill IN ('listening','speaking','reading','writing')),
  completion_id TEXT NOT NULL,
  team_id TEXT,
  week TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, skill, completion_id)
);
--> statement-breakpoint
CREATE INDEX campus_team_week ON campus_team_completions(team_id, week, user_id, skill);
