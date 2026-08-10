-- WA Mini League schema

CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,       -- canonical display name
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every raw in-game name that has ever been mapped to a player, including
-- the canonical name itself. Used to power the fuzzy-match suggestion on
-- the submit page (e.g. "dt-Daeno" -> Deano) and to improve over time.
CREATE TABLE IF NOT EXISTS aliases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  alias_text TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  played_at         TEXT,              -- date parsed from the replay itself, if present
  map_type          INTEGER,
  duration_s        INTEGER NOT NULL,
  turns             INTEGER NOT NULL,
  replay_version    INTEGER,
  winner_player_id  INTEGER REFERENCES players(id),
  is_draw           INTEGER NOT NULL DEFAULT 0,
  replay_r2_key     TEXT NOT NULL,      -- key of the stored .WAgame file in R2
  replay_filename   TEXT NOT NULL,      -- original filename, for the download link
  replay_hash       TEXT NOT NULL UNIQUE, -- sha256 of the file, prevents duplicate submissions
  submitted_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES players(id),
  raw_name   TEXT NOT NULL,             -- exact in-game/machine name as it appeared in this replay
  team_name  TEXT,
  colour     TEXT,
  shots      INTEGER DEFAULT 0,
  turns      INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_game_players_game   ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_game_players_player ON game_players(player_id);
CREATE INDEX IF NOT EXISTS idx_games_winner        ON games(winner_player_id);
CREATE INDEX IF NOT EXISTS idx_aliases_player      ON aliases(player_id);
