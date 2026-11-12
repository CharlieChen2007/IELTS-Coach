CREATE TABLE IF NOT EXISTS speaking_soe_evidence (
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  segment_count INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  pcm_hash TEXT NOT NULL,
  evaluated_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  active_ms INTEGER NOT NULL,
  pause_count INTEGER NOT NULL,
  longest_pause_ms INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY(owner_id,session_id,question_id,segment_index),
  FOREIGN KEY(request_key) REFERENCES speaking_soe_receipts(request_key)
);
CREATE INDEX IF NOT EXISTS speaking_soe_evidence_session ON speaking_soe_evidence(owner_id,session_id);
CREATE UNIQUE INDEX IF NOT EXISTS speaking_soe_evidence_receipt ON speaking_soe_evidence(request_key);
CREATE TABLE IF NOT EXISTS speaking_report_versions (
  owner_id TEXT NOT NULL, session_id TEXT NOT NULL, evidence_version TEXT NOT NULL,
  model TEXT NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY(owner_id,session_id,evidence_version,model)
);
CREATE TABLE IF NOT EXISTS speaking_report_jobs (
  owner_id TEXT NOT NULL, session_id TEXT NOT NULL, token TEXT NOT NULL, reserved_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id,session_id)
);
