# Dream League

*(Mini Strategy Roper League — internally still referred to by the older "WA Mini League" name in a few places: the repo folder, the D1 database name, `package.json`. Renaming those touches live infrastructure identifiers, so they're left alone unless you want that changed too.)*

A tiny 3-page site for tracking a Worms Armageddon mini-league from `.WAgame` replays:

- **`/`** — drop a replay, confirm/map the detected player names, submit. The winner is verified automatically — nothing to pick, unless auto-verification fails, in which case you're prompted to pick the winner yourself so the game still gets recorded. Results go live immediately. Below the drop zone: the league's scheme (`Strategy Roper`) and map pack, both downloadable.
- **`/standings.html`** — the ladder, plus a log of every submitted game with a replay download link and a provenance note (WADB-verified, self-reported, or set by an admin). Two independent prizes live here — see below. If you're logged in as an admin (in this browser tab), expanding a game also shows a Delete button here — no need to jump to `/admin.html` just to remove a bad submission.
- **`/admin.html`** — password-gated panel to fix a winner, resolve a game the auto-verification couldn't determine, delete a bad submission, merge/delete duplicate player records, review submitted issue reports, or re-run WADB verification on a stored replay. Every result change is logged with who changed it and when — see the audit trail note below. Logging in here is also what makes the "Admin" tab appear in the nav bar on every page in this browser tab — see below.

Every page also has a **Report an issue** button in the header — anyone can flag a disputed result, bad behaviour, or a site bug without logging in; only admins can see the list.

Runs entirely on Cloudflare Pages: static frontend + Pages Functions for the API, D1 (SQLite) for data, R2 for storing the uploaded replay files.

## How it works

- The `.WAgame` parser (`public/js/parser.js`) runs **client-side** for the player-mapping preview — nothing is uploaded just from picking a file. It's a trimmed port of the dreamwa.re Replay Reader tool: same team/machine-attribution logic, minus the flag/grave image extraction and chat log (not needed here).
- **Winner detection**: a `.WAgame` file doesn't record the outcome itself — WA doesn't store one. On submit, the backend (`functions/api/submit.js`) forwards the replay server-to-server to the [Worms Database API](https://wormsarmageddon.com/developers) (`wormsarmageddon.com`)'s `analyzeReplay` mutation, which actually runs the game engine and returns a real result (`teams[].won` / `winningAllianceColor`), not a guess. That gets matched against the submitted players by team colour to set the winner automatically. `analyzeReplay` is public/unauthenticated and ephemeral — it doesn't store the replay or create a public WADB page, which is exactly why we use it instead of `submitReplay` (that one requires a Discord session per-request, which doesn't work for an unattended server-to-server call; `analyzeReplay` was added by WADB's developer specifically to support this kind of use case). We already keep our own copy of the replay in R2 regardless, so losing WADB-side storage costs us nothing — we just lose the "verified via WADB ↗" link being clickable (games verified this way show the label as plain text instead, since there's no page to link to). If WADB can't determine a result (aborted game, alliance mode, an unreachable/erroring API) the game still saves, just marked `outcome_status = 'unresolved'` — it's excluded from standings until an admin resolves it via the admin panel, so a stuck game never silently skews anyone's record.
- **Diagnosing unresolved games**: every unresolved game also gets an `outcome_note` — the specific reason it couldn't be auto-verified (WADB unreachable, a non-2xx/GraphQL error from WADB, the match reported incomplete, multiple winning teams from alliance mode, or a winning colour that didn't match any submitted player). It's computed in `functions/api/submit.js` (`resolveOutcome()` / `callWadb()`), shown under the game in the admin panel's "Needs review" games, and included as a field in the Discord notification for that submission.
- Player identity across renames (e.g. `dt-Deano` / `Deano` / `dt-Daeno`) is handled by `public/js/similarity.js`: it suggests the most likely existing player (weighted toward the "core" name segment, ignoring clan-tag prefixes/suffixes) but always lets the submitter override or create a new player. Every confirmed raw name gets saved as an alias, so matching gets better over time.
- Submissions apply immediately — no approval queue. Duplicate uploads are blocked by hashing the replay file (SHA-256) and rejecting a second submission of the same hash.
- The admin panel is gated by a single shared password (`ADMIN_PASSWORD` secret), used for editing a winner/draw, resolving an unreviewed game, deleting a submission, and merging/deleting player records. Any manual edit is tagged `winner_source = 'manual'` so it's clear on the game log that it wasn't WADB-verified.
- Player identity cleanup: the fuzzy matcher on submit is a suggestion, not a guarantee, so duplicates can slip in (e.g. "Stoned-Worm" vs "StonedWorm" both getting created because neither matched confidently). The admin panel's Players section fixes this after the fact — **Merge** reassigns every game, win, and alias from one player onto another and deletes the duplicate; **Delete** removes a player outright, but only once they have zero games attached (merge first if they don't).
- Text with special/Latin-1 characters (team names, certain player names, and any UI copy with an em dash) is rendered in JetBrains Mono via the `.name-raw` class rather than the DOS bitmap font, since Perfect DOS VGA 437 mis-renders a number of those codepoints — and it does so *silently*, substituting a different wrong-looking glyph rather than an obvious "missing character" box, which is why several of these went unnoticed for a while (`&middot;` rendering as a stray `¶`/`‖`-ish mark across admin.html and elsewhere, `&laquo;`/`&raquo;` on the admin pager rendering as fraction-looking glyphs). Current policy: any element that always carries a special character defaults to JetBrains Mono at the CSS level rather than relying on each call site to remember (`.err`/`.ok`/`.dl-link`/`.victory-icon`); anywhere a plain ASCII alternative reads just as well (`&middot;` → `|`, `&laquo;`/`&raquo;` → `&lt;`/`&gt;`, `&rarr;` → `->` , `&times;` → `x`), that's used instead so there's nothing to get wrong. Text inside a native `title="..."` tooltip is always safe regardless, since browsers render those with the OS UI font, not the page's CSS.
- **Issue reports**: the "Report an issue" button (`public/js/report.js`, wired up on every page via `<button id="reportBtn">` in the header) opens a small form — category, message, and an optional name/handle if the reporter wants to identify themselves. It posts to `POST /api/reports`, which is public and requires no login, but captures the submitter's IP (`CF-Connecting-IP`) server-side and caps it at 5 reports per IP per hour to prevent spam. Reports are never shown anywhere public — only the admin panel's Reports section (`GET/PATCH/DELETE /api/admin/reports`) can see or act on them, where they can be marked resolved/reopened or deleted. Open reports are always listed first.
- **Discord notifications**: `functions/_discord.js` posts to a Discord webhook whenever a game is submitted (`functions/api/submit.js`) or a report is filed (`functions/api/reports.js`) — games and reports go to separate channels/webhooks, and a report also @-mentions an admin role so it doesn't get missed. Both calls are wrapped in `context.waitUntil(...)`, so the notification fires in the background after the response is already sent — a slow or down Discord webhook never delays or breaks a submission. If a webhook secret isn't set, that notification is just silently skipped. See the Discord setup step below.
- **Manual winner fallback**: if `analyzeReplay` can't determine a result on first submit, `functions/api/submit.js` returns `needsManualWinner: true` without saving anything. The submit page (`public/index.html`) then shows a picker so the submitter can choose the winner (or draw) themselves and resubmit — that second attempt is what actually saves the game, tagged `winner_source = 'submitter'`. This is distinct from `'wadb'` (auto-verified) and `'manual'` (an admin corrected it afterwards), and each is surfaced differently: the submit page shows "(self-reported, not WADB-verified)", the admin panel shows a "Self-reported" tag, and standings shows the same note in a game's expanded detail. The Discord game-submission notification flags it too.
- **Admin nav visibility**: the "Admin" tab is hidden from the nav bar on every page by default (`public/js/adminNav.js`) and only appears in a given browser tab after logging in at `/admin.html` — it checks for a valid session password in `sessionStorage` and silently reveals the tab if one's found and still valid. There's no way to reach it otherwise; general users only ever see Submit and Standings. A "Log out" button on the admin page clears the stored password and reloads, which removes the tab again — logging back in at `/admin.html` is the only way to get it back.
- **Audit trail**: every change to a game's result is recorded in `game_audit_log` (migration `0005`) via `functions/_gameAudit.js` — the original submission (auto-verified or self-reported), any admin edit, and any admin-triggered WADB recheck, including ones that didn't change anything. Each row captures who did it (`submitter` or `admin`), the before/after winner/draw/status, a note (e.g. why a recheck failed), and — for anything an admin does — their IP address (`CF-Connecting-IP`), so no result can change silently. Each game card in the admin panel has a collapsible **History** section (`GET /api/admin/games/:id/history`, admin-only since it exposes IPs) showing this trail in plain language. Deleting a game removes its history along with it (`ON DELETE CASCADE`) — there's nothing left to show a trail against once the game itself is gone.
- **Re-check WADB**: each game in the admin panel has a "Re-check WADB" button (`POST /api/admin/games/:id/recheck`) that re-runs `analyzeReplay` against the replay already stored in R2 — no re-upload needed. Useful if a game landed as unresolved because WADB was briefly down, or an admin just wants a second opinion on a manual/self-reported result. If WADB now returns a resolved result it overwrites whatever was there before and is tagged `winner_source = 'wadb'`; if it still can't resolve it, nothing changes but the attempt is still logged. `functions/_wadb.js` holds the shared `callWadb()`/`resolveOutcome()` logic used by both the original submit flow and this recheck endpoint, so a recheck behaves identically to what submission would have done.
- **Two admin tiers**: `ADMIN_PASSWORD` and the optional `SUPER_ADMIN_PASSWORD` both unlock the full admin panel — same access to editing games, rechecking WADB, deleting, merging players, resolving reports. The only difference is IP visibility: `functions/_authAdmin.js` exposes `isSuperAdmin()` alongside `isAdmin()`, and `GET /api/admin/games/:id/history` and `GET /api/admin/reports` both check it before deciding whether to include the real IP in the response at all. A regular admin doesn't get a "hidden" placeholder or any other hint that IP data exists — the field is simply `null`, indistinguishable from a game-history entry that never had an admin IP to begin with (e.g. the original submission). This is enforced server-side, not just hidden in the UI — a regular admin can't recover it by inspecting network responses either, and the admin page's HTML never contains IP-related text unless a super-admin session actually fills it in via JS after login. `POST /api/admin/verify` returns `isSuperAdmin` so the page can show a small "Super Admin" badge for that tier only. Leave `SUPER_ADMIN_PASSWORD` unset if you don't want a two-tier setup — everyone who knows `ADMIN_PASSWORD` just never sees IPs, or any indication that they're tracked, anywhere.
- **Two independent prizes**: `functions/api/standings.js` computes both. **Most Wins** is the ladder's actual rank order — total wins, ties broken by games played, then name; win rate and opponent diversity play no part in it. **Most Active** is a separate, unranked score (`activityScore = gamesPlayed × uniqueOpponents`) that rewards playing a wide spread of people over farming the same one or two opponents — whoever holds the top score gets `isActivityLeader: true`, shown as a quiet dot next to their name on the ladder (`.played-badge.activity-leader` in `public/css/style.css`). The two were deliberately decoupled after almost building opponent-diversity into the win ranking itself as a tiebreaker — worth knowing if this behaviour ever looks surprising in a future session's context.
- **Ladder columns**: Player (with "played 5h ago"-style relative time, from `MAX(played_at, submitted_at)` across a player's games), Wins, Players Faced (unique opponents), Games Played, a Diversity bar (opponents-faced ÷ games-played, clamped at 100% width since a single free-for-all can mean more opponents than games), and Streak. Win rate is still computed and returned by the API but no longer shown on the ladder itself, per the shift away from win-rate as the goal.
- **Games log stays quiet about winners**: the collapsed row marks a winner with a small `★` (`.victory-icon`, muted `--fg-dim`, not a colour highlight) instead of the magenta name highlight used earlier in development — the section is meant to be a neutral log, not a scoreboard. The expanded detail dropped its per-player W/L badge for the same reason (it was also just repeating what the collapsed row already showed).
- **Branding**: the site is "Dream League" (tagline "Mini Strategy Roper League") in the header/`<title>` on all three pages (`.brand-text`/`.brand-tagline` in `public/css/style.css`) — matching the Æ mark dreamwa.re itself uses. Internal identifiers (repo folder, D1 database name `wa-mini-league-db`, `package.json`'s `name`) are still the older "wa-mini-league" name; renaming those touches live infrastructure and wasn't done as part of this pass.
- **Scheme & map downloads**: `public/index.html` has a "Scheme & Maps" section below the drop zone linking to `public/downloads/strategy-roper.wsc` (the league's scheme) and `public/downloads/sroper-map-pack.zip` (10 custom maps). These are static files served straight from Pages — no API involved, no admin control over them yet. `public/downloads/sroper-maps.zip` is a leftover first copy of the map pack (contains macOS resource-fork clutter, `__MACOSX/`) that isn't linked from anywhere; safe to delete whenever someone approves it.

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

   (Optional) Set a separate super-admin password too — both log in to the same admin panel, but only the super-admin one reveals IP addresses (see below):
   ```
   npx wrangler pages secret put SUPER_ADMIN_PASSWORD
   ```

6. (Optional) Discord notifications — needs a real Discord *server* (incoming webhooks can't post to a group DM). In your server:
   - Create two channels (e.g. `#game-log` and `#reports`), each with its own webhook: channel settings (or Server Settings → Integrations → Webhooks) → New Webhook → Copy Webhook URL.
   - If you want issue reports to @-mention a role, enable Developer Mode (User Settings → Advanced) so you can right-click the role and Copy ID.
   - Set whichever of these you want as secrets — any left unset just means that notification type is silently skipped:
     ```
     npx wrangler pages secret put DISCORD_GAMES_WEBHOOK_URL
     npx wrangler pages secret put DISCORD_REPORTS_WEBHOOK_URL
     npx wrangler pages secret put DISCORD_ADMIN_ROLE_ID
     ```
   - To switch servers/channels later, just overwrite the secret with a new webhook URL (or role ID) — no code changes needed.

7. Deploy:
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
- Winner detection depends on `wormsarmageddon.com` staying up and `analyzeReplay` staying public. It's a hard dependency at submit time, but a soft one for data integrity — a WADB outage (or the endpoint changing/requiring auth again) just means new games land as `unresolved` until an admin sets the winner by hand, nothing breaks or gets blocked. It's also literally one guy's machine running the actual game engine, not a monitored service, so treat it as a nice-to-have rather than something to build hard guarantees on top of.
- Already run some but not all of these migrations on a live database? Only run the ones you're missing directly, not the whole chained script — `0002`, and now `0004`, are both plain `ALTER TABLE ADD COLUMN`, which errors if run twice:
  ```
  npx wrangler d1 execute wa-mini-league-db --remote --file=migrations/0004_outcome_note.sql
  ```
  (`0001`, `0003`, and `0005` are safe to re-run — `CREATE TABLE IF NOT EXISTS` — `0002` and `0004` aren't.)
- Reports don't do anything with the captured IP beyond the rate limit and showing it to admins for context — there's no blocklist, ban list, or de-anonymisation feature. If abuse becomes a real problem beyond the 5-per-hour cap, that's the next thing to add.
