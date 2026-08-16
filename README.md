# WA Mini League

A tiny 3-page site for tracking a Worms Armageddon mini-league from `.WAgame` replays:

- **`/`** — drop a replay, confirm/map the detected player names, submit. The winner is verified automatically — nothing to pick. Results go live immediately.
- **`/standings.html`** — ladder (games played / wins / losses / win rate) plus a log of every submitted game with a replay download link and a link to the WADB verification page.
- **`/admin.html`** — password-gated panel to fix a winner, resolve a game the auto-verification couldn't determine, delete a bad submission, merge/delete duplicate player records, or review submitted issue reports.

Every page also has a **Report an issue** button in the header — anyone can flag a disputed result, bad behaviour, or a site bug without logging in; only admins can see the list.

Runs entirely on Cloudflare Pages: static frontend + Pages Functions for the API, D1 (SQLite) for data, R2 for storing the uploaded replay files.

## How it works

- The `.WAgame` parser (`public/js/parser.js`) runs **client-side** for the player-mapping preview — nothing is uploaded just from picking a file. It's a trimmed port of the dreamwa.re Replay Reader tool: same team/machine-attribution logic, minus the flag/grave image extraction and chat log (not needed here).
- **Winner detection**: a `.WAgame` file doesn't record the outcome itself — WA doesn't store one. On submit, the backend (`functions/api/submit.js`) forwards the replay server-to-server to the [Worms Database API](https://wormsarmageddon.com/developers) (`wormsarmageddon.com`), which actually runs the game engine and returns a real result (`teams[].won` / `winningAllianceColor`), not a guess. That gets matched against the submitted players by team colour to set the winner automatically. If WADB can't determine a result (aborted game, alliance mode, an unreachable/erroring API) the game still saves, just marked `outcome_status = 'unresolved'` — it's excluded from standings until an admin resolves it via the admin panel, so a stuck game never silently skews anyone's record.
- Player identity across renames (e.g. `dt-Deano` / `Deano` / `dt-Daeno`) is handled by `public/js/similarity.js`: it suggests the most likely existing player (weighted toward the "core" name segment, ignoring clan-tag prefixes/suffixes) but always lets the submitter override or create a new player. Every confirmed raw name gets saved as an alias, so matching gets better over time.
- Submissions apply immediately — no approval queue. Duplicate uploads are blocked by hashing the replay file (SHA-256) and rejecting a second submission of the same hash.
- The admin panel is gated by a single shared password (`ADMIN_PASSWORD` secret), used for editing a winner/draw, resolving an unreviewed game, deleting a submission, and merging/deleting player records. Any manual edit is tagged `winner_source = 'manual'` so it's clear on the game log that it wasn't WADB-verified.
- Player identity cleanup: the fuzzy matcher on submit is a suggestion, not a guarantee, so duplicates can slip in (e.g. "Stoned-Worm" vs "StonedWorm" both getting created because neither matched confidently). The admin panel's Players section fixes this after the fact — **Merge** reassigns every game, win, and alias from one player onto another and deletes the duplicate; **Delete** removes a player outright, but only once they have zero games attached (merge first if they don't).
- Text with special/Latin-1 characters (team names, certain player names, and any UI copy with an em dash) is rendered in JetBrains Mono via the `.name-raw` class rather than the DOS bitmap font, since Perfect DOS VGA 437 mis-renders a number of those codepoints.
- **Issue reports**: the "Report an issue" button (`public/js/report.js`, wired up on every page via `<button id="reportBtn">` in the header) opens a small form — category, message, and an optional name/handle if the reporter wants to identify themselves. It posts to `POST /api/reports`, which is public and requires no login, but captures the submitter's IP (`CF-Connecting-IP`) server-side and caps it at 5 reports per IP per hour to prevent spam. Reports are never shown anywhere public — only the admin panel's Reports section (`GET/PATCH/DELETE /api/admin/reports`) can see or act on them, where they can be marked resolved/reopened or deleted. Open reports are always listed first.

## Setup

1. Install deps:
   ```
   npm install
   ```

2. Create the D1 database and note the returned `database_id`:
   ```
   npx wrangler d1 create wa-mini-league-db
   ```
   Paste that ID into `wrangler.toml` under `[[d1_databases]]`.

3. Create the R2 bucket for replay storage:
   ```
   npx wrangler r2 bucket create wa-mini-league-replays
   ```

4. Run the schema migration:
   ```
   npm run db:migrate:remote
   ```
   (use `db:migrate:local` first if you want to test with `wrangler pages dev` locally)

5. Set the admin password as a secret (never commit this):
   ```
   npx wrangler pages secret put ADMIN_PASSWORD
   ```

6. Deploy:
   ```
   npm run deploy
   ```
   Or connect the repo to Cloudflare Pages in the dashboard for git-based auto-deploys, same as your other Cloudflare-hosted sites.

## Local dev

```
npm run dev
```
Runs `wrangler pages dev` with local D1 + R2 bindings (make sure you ran `db:migrate:local` first).

## Project layout

```
public/              static frontend (submit / standings / admin pages)
  js/parser.js        client-side .WAgame parser
  js/similarity.js    fuzzy name-matching for player identity
  js/report.js        shared "Report an issue" modal, wired up on every page
functions/api/        Cloudflare Pages Functions (the backend API)
migrations/           D1 schema
```

## Notes / things to revisit later

- Admin auth is a single shared password checked per-request — fine for a small trusted league, but if this grows, swap for per-moderator accounts.
- No rate limiting or spam protection on `/api/submit` — running on the honour system by design for now.
- The fuzzy player-matching is a suggestion only; it's not perfect and doesn't need to be, since a human always confirms it before submit.
- Winner detection depends on `wormsarmageddon.com` staying up and unauthenticated. It's a hard dependency at submit time, but a soft one for data integrity — a WADB outage just means new games land as `unresolved` until an admin sets the winner by hand, nothing breaks or gets blocked.
- Already ran `0001_init.sql` and `0002_wadb_outcome.sql` on a live database before this update? Just run `0003_reports.sql` directly rather than the chained script, since re-running `0002`'s plain `ALTER TABLE ADD COLUMN` a second time will error:
  ```
  npx wrangler d1 execute wa-mini-league-db --remote --file=migrations/0003_reports.sql
  ```
  (`0001` and `0003` are both safe to re-run — `CREATE TABLE IF NOT EXISTS` — only `0002` isn't.)
- Reports don't do anything with the captured IP beyond the rate limit and showing it to admins for context — there's no blocklist, ban list, or de-anonymisation feature. If abuse becomes a real problem beyond the 5-per-hour cap, that's the next thing to add.
