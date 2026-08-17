// POST /api/submit — accepts a replay file + parsed metadata + the
// submitter's player mappings, and persists it all. The winner is no
// longer a submitter choice: the replay is forwarded server-side to the
// Worms Database API (wormsarmageddon.com), which actually runs the game
// engine and returns a real winner rather than a guess. See outcome
// resolution below for what happens when that can't be determined.
//
// Expected multipart/form-data fields:
//   file    - the raw .WAgame File
//   meta    - JSON: { playedAt, mapType, durationSeconds, turns, version }
//   players - JSON array in team order:
//               [{ rawName, teamName, colour, shots, turns,
//                  playerId?: number, newPlayerName?: string }]
//             exactly one of playerId / newPlayerName must be set per entry

import { notifyDiscord, buildGameEmbed } from '../_discord.js';

const WADB_ENDPOINT = 'https://wormsarmageddon.com/api';
const WADB_QUERY = `
  mutation ($replay: Upload!) {
    submitReplay(replay: $replay) {
      id
      slug
      matchComplete
      winningAllianceColor
      teams { name color won }
    }
  }
`;

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Calls the WADB submitReplay mutation. Returns { ok: true, game } on a
// clean GraphQL response, or { ok: false, reason } if the call failed or
// returned GraphQL errors — callers treat that as "couldn't verify",
// not as a reason to reject the submission outright.
async function callWadb(bytes, filename) {
  try {
    const fd = new FormData();
    fd.set('operations', JSON.stringify({ query: WADB_QUERY, variables: { replay: null } }));
    fd.set('map', JSON.stringify({ '0': ['variables.replay'] }));
    fd.set('0', new Blob([bytes]), filename || 'replay.WAgame');

    const res = await fetch(WADB_ENDPOINT, { method: 'POST', body: fd });
    if (!res.ok) return { ok: false, reason: `WADB returned HTTP ${res.status}` };

    const json = await res.json();
    if (json.errors?.length) return { ok: false, reason: json.errors[0]?.message || 'WADB reported an error' };
    if (!json.data?.submitReplay) return { ok: false, reason: 'WADB returned no game data' };

    return { ok: true, game: json.data.submitReplay };
  } catch (err) {
    return { ok: false, reason: 'Could not reach WADB: ' + (err?.message || err) };
  }
}

// Turns a WADB game result + our resolved player list into an outcome.
// players[i].colour is our locally-parsed team colour name (e.g. "Magenta");
// WADB's team.color is an uppercase enum (e.g. "MAGENTA") — compare
// case-insensitively.
function resolveOutcome(wadbGame, players, resolvedPlayerIds) {
  if (!wadbGame.matchComplete) {
    return {
      outcomeStatus: 'unresolved', winnerSource: null, winnerPlayerId: null, isDraw: 0,
      note: 'WADB reported the match as not complete (aborted or interrupted game).'
    };
  }

  const winners = (wadbGame.teams || []).filter(t => t.won === true);

  if (winners.length === 0) {
    return { outcomeStatus: 'draw', winnerSource: 'wadb', winnerPlayerId: null, isDraw: 1, note: null };
  }

  if (winners.length === 1) {
    const idx = players.findIndex(p => (p.colour || '').toUpperCase() === (winners[0].color || '').toUpperCase());
    if (idx !== -1) {
      return { outcomeStatus: 'confirmed', winnerSource: 'wadb', winnerPlayerId: resolvedPlayerIds[idx], isDraw: 0, note: null };
    }
    return {
      outcomeStatus: 'unresolved', winnerSource: null, winnerPlayerId: null, isDraw: 0,
      note: `WADB reported the winning colour as "${winners[0].color}", but no submitted player was mapped to that colour.`
    };
  }

  // Multiple winners — alliance mode, most likely.
  return {
    outcomeStatus: 'unresolved', winnerSource: null, winnerPlayerId: null, isDraw: 0,
    note: `WADB reported ${winners.length} winning teams (likely alliance mode) — can't auto-assign a single winner.`
  };
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

  let meta, players;
  try {
    meta = JSON.parse(form.get('meta') || '{}');
    players = JSON.parse(form.get('players') || '[]');
  } catch {
    return Response.json({ error: 'Malformed meta/players JSON.' }, { status: 400 });
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

  // Ask WADB who actually won. This never blocks the submission — if it
  // fails or can't be resolved, the game still gets saved as 'unresolved'
  // and an admin can set the winner by hand later.
  const wadbResult = await callWadb(bytes, file.name);
  let outcome = { outcomeStatus: 'unresolved', winnerSource: null, winnerPlayerId: null, isDraw: 0, note: wadbResult.ok ? null : wadbResult.reason };
  let wadbSlug = null, wadbGameId = null;
  if (wadbResult.ok) {
    outcome = resolveOutcome(wadbResult.game, players, resolvedPlayerIds);
    wadbSlug = wadbResult.game.slug || null;
    wadbGameId = wadbResult.game.id || null;
  }

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

  // Fire-and-forget: notify the games Discord channel without delaying the
  // response to the submitter.
  context.waitUntil(notifyDiscord(
    env.DISCORD_GAMES_WEBHOOK_URL,
    buildGameEmbed(
      { players, winnerName, isDraw: outcome.isDraw, outcomeStatus: outcome.outcomeStatus, note: outcome.note },
      new URL(request.url).origin
    )
  ));

  return Response.json({
    ok: true,
    gameId,
    outcomeStatus: outcome.outcomeStatus,
    winnerName,
    wadbNote: outcome.note
  });
}
