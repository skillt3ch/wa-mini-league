-- Track how a game's outcome was determined, so the UI can distinguish
-- "auto-verified via the Worms Database API" from "an admin set this by
-- hand" from "nobody's confirmed this yet" — and so standings can safely
-- exclude the last case until it's resolved.
--
-- outcome_status:
--   'confirmed'  - a winner is known (via WADB or admin edit)
--   'draw'       - confirmed as a draw
--   'unresolved' - could not be determined automatically; needs an admin
--                  to set the winner/draw via the admin panel
--
-- winner_source: 'wadb' | 'manual' | NULL (NULL only while unresolved)

ALTER TABLE games ADD COLUMN outcome_status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE games ADD COLUMN winner_source TEXT;
ALTER TABLE games ADD COLUMN wadb_slug TEXT;
ALTER TABLE games ADD COLUMN wadb_game_id TEXT;

-- Backfill: anything already in the table was set by the old manual picker.
UPDATE games SET winner_source = 'manual' WHERE winner_source IS NULL;
