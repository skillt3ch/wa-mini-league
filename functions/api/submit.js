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
// regardless, we only ever needed the winner. It does mean there's no
// WADB page to link to, so we don't request/store an id or slug here.
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
//                       playerId?: number, newPlayerName?: string }]
//                  exactly one of playerId / newPlayerName must be set per entry
//   manualWinner - optional JSON: { isDraw: boolean, rawIndex: number|null }
//                  rawIndex is an index into the players array above; only
//                  sent on the resubmit after a needsManualWinner response

import { notifyDiscord, buildGameEmbed } from '../_discord.js';
import { callWadb, resolveOutcome } from '../_wadb.js';
import { logGameAudit } from '../_gameAudit.js';

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { env, request } = context;

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

  // Resolve each player entry to a player_id, creating new players/aliases
  // as needed. Every raw in-game name gets recorded as an alias so future
  // submissions with the same variant auto-suggest correctly.
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
    // Ask WADB who actually won. This never blocks the submission — if it
    // fails or can't be resolved, nothing is saved yet; the response tells
    // the client to prompt for a manual winner instead.
    const wadbResult = await callWadb(bytes, file.name);
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
  // themselves after auto-verification failed.
  await logGameAudit(env, {
    gameId,
    action: 'submitted',
    actor: 'submitter',
    after: { winnerSource: outcome.winnerSource, winnerPlayerId: outcome.winnerPlayerId, isDraw: !!outcome.isDraw, outcomeStatus: outcome.outcomeStatus },
    note: outcome.note
  });

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
    wadbNote: outcome.note
  });
}
