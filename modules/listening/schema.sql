CREATE TABLE IF NOT EXISTS listening_sections (
  owner TEXT NOT NULL, practice TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
  wrongbook TEXT NOT NULL DEFAULT '[]', latest TEXT, receipt TEXT,
  PRIMARY KEY(owner, practice)
);
CREATE TABLE IF NOT EXISTS listening_attempts (
  owner TEXT NOT NULL, id TEXT NOT NULL, practice TEXT NOT NULL,
  snapshot TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(owner, id)
);
CREATE INDEX IF NOT EXISTS listening_history ON listening_attempts(owner, practice);
-- Commit the immutable attempt and the current section together, including on D1.
CREATE TRIGGER IF NOT EXISTS listening_save_attempt AFTER UPDATE OF receipt ON listening_sections
WHEN NEW.receipt IS NOT NULL
BEGIN
  INSERT INTO listening_attempts(owner,id,practice,snapshot,summary)
  VALUES(NEW.owner, NEW.latest, NEW.practice, json_extract(NEW.receipt,'$.response'), json_extract(NEW.receipt,'$.attempt'));
END;
