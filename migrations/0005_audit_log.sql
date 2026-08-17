-- Full audit trail for every winner/outcome change on a game: the initial
-- submission (auto-verified via WADB, or self-reported by the submitter
-- when WADB couldn't verify it), any admin correction, and any admin-
-- triggered WADB recheck (whether or not it actually changed anything).
-- Nothing about a game's result can change without a row landing here,
-- including the IP of the admin who made the change.

CREATE TABLE IF NOT EXISTS game_audit_log (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id                INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  action                 TEXT NOT NULL,   -- 'submitted' | 'winner_edit' | 'wadb_recheck'
  actor                  TEXT NOT NULL,   -- 'submitter' | 'admin'
  admin_ip               TEXT,            -- IP of the admin who made the change (NULL for 'submitted')
  old_winner_source      TEXT,
  old_winner_player_id   INTEGER REFERENCES players(id),
  old_is_draw            INTEGER,
  old_outcome_status     TEXT,
  new_winner_source      TEXT,
  new_winner_player_id   INTEGER REFERENCES players(id),
  new_is_draw            INTEGER,
  new_outcome_status     TEXT,
  note                   TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_audit_log_game ON game_audit_log(game_id);
