CREATE TABLE IF NOT EXISTS speaking_soe_receipts (
  request_key TEXT PRIMARY KEY,
  reserved_at INTEGER NOT NULL,
  result_json TEXT
);
CREATE INDEX IF NOT EXISTS speaking_soe_receipts_age ON speaking_soe_receipts(reserved_at);
