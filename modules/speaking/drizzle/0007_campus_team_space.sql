ALTER TABLE campus_teams ADD COLUMN space TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX campus_team_space_matches ON campus_teams(space, exam_month, target, created_at DESC);
