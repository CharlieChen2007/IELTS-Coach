CREATE TABLE IF NOT EXISTS listening_type_results (
  owner TEXT NOT NULL,
  drill TEXT NOT NULL,
  revision INTEGER NOT NULL,
  answer TEXT NOT NULL,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (owner, drill)
);
