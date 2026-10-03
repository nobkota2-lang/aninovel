CREATE TABLE IF NOT EXISTS periods (
  period        TEXT PRIMARY KEY,
  revenue_yen   REAL NOT NULL DEFAULT 0,
  owner_rate    REAL NOT NULL DEFAULT 0.5,
  total_points  REAL NOT NULL DEFAULT 0,
  yen_per_point REAL NOT NULL DEFAULT 0,
  confirmed     INTEGER NOT NULL DEFAULT 0,
  computed_at   TEXT,
  note          TEXT
);
CREATE TABLE IF NOT EXISTS payouts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  author_email TEXT NOT NULL,
  amount_yen   INTEGER NOT NULL,
  paid_at      TEXT NOT NULL,
  method       TEXT,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_payouts_author ON payouts(author_email, paid_at);
ALTER TABLE points ADD COLUMN amount_yen REAL NOT NULL DEFAULT 0;
