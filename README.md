# WA Mini League

A tiny 3-page site for tracking a Worms Armageddon mini-league from `.WAgame` replays:

- **`/`** — drop a replay, confirm/map the detected player names, pick the winner, submit. Results go live immediately.
- **`/standings.html`** — ladder (games played / wins / losses / win rate) plus a log of every submitted game with a replay download link.
- **`/admin.html`** — password-gated panel to fix a winner or delete a bad submission.

Runs entirely on Cloudflare Pages: static frontend + Pages Functions for the API, D1 (SQLite) for data, R2 for storing the uploaded replay files.

## How it works

- The `.WAgame` parser (`public/js/parser.js`) runs **client-side** — nothing about the binary format touches the server. It's a trimmed port of the dreamwa.re Replay Reader tool: same team/machine-attribution logic, minus the flag/grave image extraction and chat log (not needed here).
- Winner detection is **not** in the replay file — WA doesn't record it — so the submitter picks it manually, same as the original tool.
- Player identity across renames (e.g. `dt-Deano` / `Deano` / `dt-Daeno`) is handled by `public/js/similarity.js`: it suggests the most likely existing player (weighted toward the "core" name segment, ignoring clan-tag prefixes/suffixes) but always lets the submitter override or create a new player. Every confirmed raw name gets saved as an alias, so matching gets better over time.
- Submissions apply immediately — no approval queue. Duplicate uploads are blocked by hashing the replay file (SHA-256) and rejecting a second submission of the same hash.
- The admin panel is gated by a single shared password (`ADMIN_PASSWORD` secret), used for both editing a winner/draw and deleting a submission.

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
functions/api/        Cloudflare Pages Functions (the backend API)
migrations/           D1 schema
```

## Notes / things to revisit later

- Admin auth is a single shared password checked per-request — fine for a small trusted league, but if this grows, swap for per-moderator accounts.
- No rate limiting or spam protection on `/api/submit` — running on the honour system by design for now.
- The fuzzy player-matching is a suggestion only; it's not perfect and doesn't need to be, since a human always confirms it before submit.
