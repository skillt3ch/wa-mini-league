-- Records every time WADB's authoritative team->player resolution
-- disagreed with what the local .WAgame parser (public/js/parser.js) and/or
-- the submitter came up with for a team's raw name. WADB actually runs the
-- game engine, so on a discrepancy its answer wins -- game_players.raw_name
-- and the credited player_id both get corrected to match it before saving
-- (see applyWadbIdentityCorrections in functions/_wadb.js). This table
-- exists purely so we can look back over real discrepancies later and see
-- what pattern of replay actually fooled the local parser, instead of only
-- ever seeing the (much rarer) case it already knew to flag as uncertain --
-- local_identity_uncertain lets us tell those two situations apart.

CREATE TABLE IF NOT EXISTS parser_discrepancies (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id                  INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  colour                   TEXT NOT NULL,
  local_raw_name           TEXT,              -- what the client (parser.js + submitter) had for this colour
  local_identity_uncertain INTEGER NOT NULL DEFAULT 0, -- whether parser.js had already flagged this team unresolved
  wadb_player_name         TEXT NOT NULL,     -- WADB's engine-resolved Player.name for this team
  wadb_is_spectator        INTEGER,           -- WADB's Player.spectator flag (expected false for a team's owner)
  wadb_is_host             INTEGER,           -- WADB's Player.host flag
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_parser_discrepancies_game ON parser_discrepancies(game_id);
