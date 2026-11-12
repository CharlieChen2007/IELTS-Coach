CREATE TABLE IF NOT EXISTS speaking_soe_usage (
  id INTEGER PRIMARY KEY,
  usage_day TEXT NOT NULL,
  kind TEXT NOT NULL,
  visitor TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS soe_usage_by_day ON speaking_soe_usage(usage_day, kind, visitor);
