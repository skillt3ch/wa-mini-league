-- Player-facing complaint/issue reports. No login required to submit (same
-- honour-system philosophy as replay submission) — anyone can flag a
-- problem (a disputed result, bad behaviour, a site bug) via a small form,
-- and only admins can see or act on the list.

CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category      TEXT NOT NULL DEFAULT 'other',   -- 'player' | 'bug' | 'other'
  message       TEXT NOT NULL,
  reporter_name TEXT,                             -- optional, submitter's own gamer handle/name
  ip_address    TEXT,                             -- captured server-side for abuse prevention only
  status        TEXT NOT NULL DEFAULT 'open',     -- 'open' | 'resolved'
  submitted_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
