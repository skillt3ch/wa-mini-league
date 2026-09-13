// POST /api/submit — accepts a replay file + parsed metadata + the
// submitter's player mappings, and persists it all. The winner is no
// longer a submitter choice: the replay is forwarded server-side to the
// Worms Database API (wormsarmageddon.com), which actually runs the game
// engine and returns a real winner rather than a guess. See outcome
// resolution below for what happens when that can't be determined.
//
// Uses WADB's `analyzeReplay` mutation, not `submitReplay` — it runs the
// same engine analysis but is public/unauthenticated and doesn't persist
// anything on WADB's end (no stored replay, no public game page). That's
// fine for us: we already store our own copy of the replay in R2
// regardless. It does mean there's no WADB page to link to, so we don't
// request/store an id or slug here.
//
// Also used, since it's already being called anyway, to cross-check team
// identity: WADB resolves each team's actual controlling player itself
// (engine-side), which is more trustworthy than the local .WAgame parser's
// byte-signature heuristic for exactly the case that heuristic struggles
// with — a spectator getting mis-attributed as a team's owner. Any
// disagreement is corrected in `players` before it's ever written to the
// DB (see applyWadbIdentityCorrections in ../_wadb.js) and logged to
// parser_discrepancies for later analysis.
//
// Two-pass flow when WADB can't determine a winner: the first request (no
// manualWinner field) tries WADB; if it comes back unresolved, nothing is
// persisted yet — the response just says needsManualWinner: true so the
// client can show a picker. The client then resubmits the *same* file/meta/
// players plus a manualWinner field; that second pass skips WADB entirely
// (no point asking twice) and saves with winner_source = 'submitter', which
// is distinct from 'wadb' (auto-verified) and 'manual' (an admin corrected
// it later) so these stay visibly flagged as self-reported everywhere.
//
// Expected multipart/form-data fields:
//   file         - the raw .WAgame File
//   meta         - JSON: { playedAt, mapType, durationSeconds, turns, version }
//   players      - JSON array in team order:
//                    [{ rawName, teamName, colour, shots, turns,
//                       playerId?: number, newPlayerName?: string,
//                       identityUncertain?: boolean }]
//                  exactly one of playerId / newPlayerName must be set per entry.
//                  identityUncertain (from parser.js) is only used for the
//                  parser_discrepancies log below, not for resolution.
//   manualWinner - optional JSON: { isDraw: boolean, rawIndex: number|null }
//                  rawIndex is an index into the players array above; only
//                  sent on the resubmit after a needsManualWinner response

import { notifyDiscord, buildGameEmbed } from '../_discord.js';
import { callWadb, resolveOutcome, applyWadbIdentityCorrections } from '../_wadb.js';
import { logGameAudit } from '../_gameAudit.js';
import { getClientIp } from '../_util.js';
import { leagueHasEnded, LEAGUE_ENDS_AT } from '../_league.js';

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Top-level safety net: any unexpected exception anywhere below (a D1
// error, a bad assumption about WADB's response shape, anything) still
// needs to come back as JSON the client can parse and show as an error
// message — not an uncaught-exception page, which the client can't parse
// at all (shows up client-side as a raw "JSON.parse: unexpected character"
// error instead of an actual message). The specific WADB/identity-
// correction steps below have their own narrower try/catches for this same
// reason; this is the catch-all for anything else.
export async function onRequestPost(context) {
  try {
    return await handleSubmit(context);
  } catch (err) {
    return Response.json({ error: 'Unexpected server error: ' + (err?.message || err) }, { status: 500 });
  }
}

async function handleSubmit(context) {
  const { env, request } = context;

  // Authoritative deadline check — independent of whatever the submit page's
  // own countdown/lock UI shows, since a cached page or a clock a few
  // minutes off shouldn't let a late submission through. See ../_league.js.
  if (leagueHasEnded()) {
    return Response.json(
      { error: `Submissions are closed — the league ended at ${LEAGUE_ENDS_AT}.` },
      { status: 403 }
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return Response.json({ error: 'Missing replay file.' }, { status: 400 });
  }

  let meta, players, manualWinner;
  try {
    meta = JSON.parse(form.get('meta') || '{}');
    players = JSON.parse(form.get('players') || '[]');
    manualWinner = form.get('manualWinner') ? JSON.parse(form.get('manualWinner')) : null;
  } catch {
    return Response.json({ error: 'Malformed meta/players/manualWinner JSON.' }, { status: 400 });
  }

  if (!Array.isArray(players) || players.length < 2) {
    return Response.json({ error: 'Need at least two players.' }, { status: 400 });
  }
  for (const p of players) {
    if (!p.playerId && !p.newPlayerName) {
      return Response.json({ error: `Player "${p.rawName}" was not mapped to a player.` }, { status: 400 });
    }
  }

  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(bytes);

  const existing = await env.DB.prepare(
    `SELECT id FROM games WHERE replay_hash = ?`
  ).bind(hash).first();
  if (existing) {
    return Response.json(
      { error: 'This replay has already been submitted.', gameId: existing.id },
      { status: 409 }
    );
  }

  // Ask WADB up front — before resolving any player_id below — so any
  // team<->player identity discrepancy it reveals corrects `players` in
  // place first. Doing this before player resolution (rather than after,
  // where the WADB call used to happen) matters: otherwise a locally
  // mis-attributed raw name — e.g. a spectator's name, or a team's own
  // fantasy name when the parser flagged it uncertain — would already have
  // created or aliased a player record for the WRONG identity by the time
  // we found out WADB disagreed. Skipped entirely on the manualWinner
  // resubmit pass, same as the actual winner lookup further down — WADB
  // already had its say on the first pass for this exact replay.
  let wadbResult = null, wadbCorrections = [];
  if (!manualWinner) {
    wadbResult = await callWadb(bytes, file.name);
    if (wadbResult.ok) {
      // applyWadbIdentityCorrections does its own DB reads/writes
      // (players/aliases lookups) — anything unexpected in there (a schema
      // mismatch, a transient D1 error) shouldn't take the whole
      // submission down with it. Degrade to "treat WADB as unavailable"
      // instead: the existing needsManualWinner path already handles that
      // gracefully, and it's far better than an uncaught exception turning
      // into a raw error page the client can't even parse as JSON.
      try {
        wadbCorrections = await applyWadbIdentityCorrections(env, players, wadbResult.game);
      } catch (err) {
        wadbResult = { ok: false, reason: 'Identity cross-check failed: ' + (err?.message || err) };
        wadbCorrections = [];
      }
    }
  }

  // Resolve each player entry to a player_id, creating new players/aliases
  // as needed. Every raw in-game name gets recorded as an alias so future
  // submissions with the same variant auto-suggest correctly. Runs against
  // the WADB-corrected `players` array above when applicable, so a
  // corrected identity is what actually gets created/credited — not the
  // (possibly wrong) locally-parsed one.
  const resolvedPlayerIds = [];
  for (const p of players) {
    let playerId = p.playerId ? Number(p.playerId) : null;

    if (!playerId) {
      const name = String(p.newPlayerName).trim();
      if (!name) return Response.json({ error: 'New player name cannot be empty.' }, { status: 400 });
      try {
        const res = await env.DB.prepare(
          `INSERT INTO players (name) VALUES (?)`
        ).bind(name).run();
        playerId = res.meta.last_row_id;
      } catch {
        // Name collided with an existing player (unique constraint) — reuse it.
        const row = await env.DB.prepare(`SELECT id FROM players WHERE name = ?`).bind(name).first();
        if (!row) throw new Error('Could not resolve or create player.');
        playerId = row.id;
      }
    }

    if (p.rawName) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO aliases (player_id, alias_text) VALUES (?, ?)`
      ).bind(playerId, p.rawName).run();
    }

    resolvedPlayerIds.push(playerId);
  }

  let outcome;
  if (manualWinner) {
    // Resubmit after a needsManualWinner response — WADB already couldn't
    // resolve this exact replay once, so don't ask it again.
    if (manualWinner.isDraw) {
      outcome = { outcomeStatus: 'draw', winnerSource: 'submitter', winnerPlayerId: null, isDraw: 1, note: null };
    } else {
      const idx = Number(manualWinner.rawIndex);
      const winnerPlayerId = resolvedPlayerIds[idx];
      if (!Number.isInteger(idx) || !winnerPlayerId) {
        return Response.json({ error: 'Invalid manual winner selection.' }, { status: 400 });
      }
      outcome = { outcomeStatus: 'confirmed', winnerSource: 'submitter', winnerPlayerId, isDraw: 0, note: null };
    }
  } else {
    // wadbResult was already fetched above (before player resolution) so
    // the identity corrections could apply first. This never blocks the
    // submission — if it fails or can't be resolved, nothing is saved yet;
    // the response tells the client to prompt for a manual winner instead.
    outcome = { outcomeStatus: 'unresolved', winnerSource: null, winnerPlayerId: null, isDraw: 0, note: wadbResult.ok ? null : wadbResult.reason };
    if (wadbResult.ok) {
      outcome = resolveOutcome(wadbResult.game, players, resolvedPlayerIds);
    }
    if (outcome.outcomeStatus === 'unresolved') {
      return Response.json({ ok: false, needsManualWinner: true, wadbNote: outcome.note });
    }
  }

  // analyzeReplay is ephemeral — no stored replay or public page on WADB's
  // end — so there's no id/slug to keep. These columns stay populated only
  // for games verified before this change (via the old submitReplay flow).
  const wadbSlug = null, wadbGameId = null;

  const r2Key = `replays/${hash}.WAgame`;
  await env.REPLAYS.put(r2Key, bytes);

  const gameRes = await env.DB.prepare(`
    INSERT INTO games
      (played_at, map_type, duration_s, turns, replay_version,
       winner_player_id, is_draw, replay_r2_key, replay_filename, replay_hash,
       outcome_status, winner_source, wadb_slug, wadb_game_id, outcome_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    meta.playedAt || null,
    meta.mapType ?? null,
    meta.durationSeconds ?? 0,
    meta.turns ?? 0,
    meta.version ?? null,
    outcome.winnerPlayerId,
    outcome.isDraw,
    r2Key,
    file.name || 'replay.WAgame',
    hash,
    outcome.outcomeStatus,
    outcome.winnerSource,
    wadbSlug,
    wadbGameId,
    outcome.note || null
  ).run();
  const gameId = gameRes.meta.last_row_id;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    await env.DB.prepare(`
      INSERT INTO game_players (game_id, player_id, raw_name, team_name, colour, shots, turns)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(gameId, resolvedPlayerIds[i], p.rawName, p.teamName || null, p.colour || null, p.shots || 0, p.turns || 0).run();
  }

  let winnerName = null;
  if (outcome.winnerPlayerId) {
    const row = await env.DB.prepare(`SELECT name FROM players WHERE id = ?`).bind(outcome.winnerPlayerId).first();
    winnerName = row?.name || null;
  }

  // First entry in this game's audit trail. actor is 'submitter' either way
  // (they're the one who filed the form) — winnerSource on the "after" side
  // is what tells you whether WADB verified it or the submitter picked it
  // themselves after auto-verification failed. adminIp here holds the
  // *submitter's* IP, not an admin's — the column/field name predates this
  // and is generic in practice ("whoever's IP performed this logged
  // action"); see the redaction note in functions/api/admin/games/[id]/
  // history.js for why that's still fine to reuse. Captured for every
  // submission, super-admin-only visibility, same as everywhere else IP
  // data shows up in the admin panel.
  await logGameAudit(env, {
    gameId,
    action: 'submitted',
    actor: 'submitter',
    adminIp: getClientIp(request),
    after: { winnerSource: outcome.winnerSource, winnerPlayerId: outcome.winnerPlayerId, isDraw: !!outcome.isDraw, outcomeStatus: outcome.outcomeStatus },
    note: outcome.note
  });

  // One row per WADB-corrected identity, purely as data to look back over
  // later (see migrations/0006_parser_discrepancies.sql) — plus a single
  // audit-log entry so it's visible in this game's own History panel too,
  // same place every other change to this game shows up. The game itself
  // is already fully saved by this point (correct identity and all), so
  // this is wrapped defensively: a failure here (e.g. this migration not
  // having been applied yet) should never turn an otherwise-successful
  // submission into an uncaught exception / raw error page.
  if (wadbCorrections.length) {
    try {
      for (const c of wadbCorrections) {
        await env.DB.prepare(`
          INSERT INTO parser_discrepancies
            (game_id, colour, local_raw_name, local_identity_uncertain, wadb_player_name, wadb_is_spectator, wadb_is_host)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(gameId, c.colour, c.oldName, c.wasUncertain ? 1 : 0, c.newName, c.wadbSpectator ? 1 : 0, c.wadbHost ? 1 : 0).run();
      }
      await logGameAudit(env, {
        gameId,
        action: 'identity_corrected',
        actor: 'system',
        note: wadbCorrections.map(c => `${c.colour}: "${c.oldName}"${c.wasUncertain ? ' (parser unsure)' : ''} -> "${c.newName}" (WADB)`).join('; ')
      });
    } catch (err) {
      console.error('Failed to log identity corrections for game', gameId, err);
    }
  }

  // Fire-and-forget: notify the games Discord channel without delaying the
  // response to the submitter.
  context.waitUntil(notifyDiscord(
    env.DISCORD_GAMES_WEBHOOK_URL,
    buildGameEmbed(
      { players, winnerName, isDraw: outcome.isDraw, outcomeStatus: outcome.outcomeStatus, note: outcome.note, winnerSource: outcome.winnerSource },
      new URL(request.url).origin
    )
  ));

  return Response.json({
    ok: true,
    gameId,
    outcomeStatus: outcome.outcomeStatus,
    winnerName,
    winnerSource: outcome.winnerSource,
    wadbNote: outcome.note,
    identityCorrections: wadbCorrections.length
  });
}
