-- Store *why* a game ended up unresolved, so the admin panel can show more
-- than just "Needs review" — was WADB unreachable, did it return an HTTP
-- error, was the match reported incomplete, was it alliance mode with
-- multiple winning teams, or did the winning colour not match any
-- submitted player? Populated in functions/api/submit.js.

ALTER TABLE games ADD COLUMN outcome_note TEXT;
