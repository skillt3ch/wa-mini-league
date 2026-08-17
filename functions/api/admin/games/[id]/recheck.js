import { isAdmin, unauthorized } from '../../../../_authAdmin.js';
import { callWadb, resolveOutcome } from '../../../../_wadb.js';
import { logGameAudit } from '../../../../_gameAudit.js';

function adminIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';
}

// POST /api/admin/games/:id/recheck — re-runs WADB's analyzeReplay against
// the replay file already stored in R2 for this game (no re-upload
// needed). Useful when a game landed as unresolved because WADB was
// briefly down, or when an admin just wants a second opinion against a
// manual/self-reported result. Always logs an audit entry, even when the
// recheck changes nothing — the fact that a recheck was attempted (and by
// whom) is itself part of the trail.
export async function onRequestPost(context) {
  const { env, request, params } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const id = Number(params.id);
  const game = await env.DB.prepare(
    `SELECT id, replay_r2_key, replay_filename, winner_player_id, is_draw, outcome_status, winner_source
     FROM games WHERE id = ?`
  ).bind(id).first();
  if (!game) return Response.json({ error: 'Game not found.' }, { status: 404 });

  const obj = await env.REPLAYS.get(game.replay_r2_key);
  if (!obj) return Response.json({ error: 'Stored replay file is missing — cannot recheck.' }, { status: 404 });
  const bytes = await obj.arrayBuffer();

  const gamePlayers = await env.DB.prepare(
    `SELECT player_id, colour FROM game_players WHERE game_id = ?`
  ).bind(id).all();
  const players = gamePlayers.results.map(p => ({ colour: p.colour }));
  const resolvedPlayerIds = gamePlayers.results.map(p => p.player_id);

  const before = {
    winnerSource: game.winner_source,
    winnerPlayerId: game.winner_player_id,
    isDraw: !!game.is_draw,
    outcomeStatus: game.outcome_status
  };
  const ip = adminIp(request);

  const wadbResult = await callWadb(bytes, game.replay_filename);
  if (!wadbResult.ok) {
    await logGameAudit(env, {
      gameId: id, action: 'wadb_recheck', actor: 'admin', adminIp: ip,
      before, after: before, note: `Recheck failed: ${wadbResult.reason}`
    });
    return Response.json({ ok: true, changed: false, note: wadbResult.reason });
  }

  const outcome = resolveOutcome(wadbResult.game, players, resolvedPlayerIds);

  if (outcome.outcomeStatus === 'unresolved') {
    await logGameAudit(env, {
      gameId: id, action: 'wadb_recheck', actor: 'admin', adminIp: ip,
      before, after: before, note: `Recheck still unresolved: ${outcome.note}`
    });
    return Response.json({ ok: true, changed: false, note: outcome.note });
  }

  // WADB gave a real result — apply it, overwriting whatever was there
  // before (manual, self-reported, or a stale WADB result), since the
  // admin explicitly asked for a fresh check. Fully logged either way.
  await env.DB.prepare(
    `UPDATE games SET winner_player_id = ?, is_draw = ?, outcome_status = ?, winner_source = 'wadb', outcome_note = NULL WHERE id = ?`
  ).bind(outcome.winnerPlayerId, outcome.isDraw, outcome.outcomeStatus, id).run();

  const after = {
    winnerSource: 'wadb',
    winnerPlayerId: outcome.winnerPlayerId,
    isDraw: !!outcome.isDraw,
    outcomeStatus: outcome.outcomeStatus
  };

  await logGameAudit(env, {
    gameId: id, action: 'wadb_recheck', actor: 'admin', adminIp: ip,
    before, after, note: null
  });

  let winnerName = null;
  if (outcome.winnerPlayerId) {
    const row = await env.DB.prepare(`SELECT name FROM players WHERE id = ?`).bind(outcome.winnerPlayerId).first();
    winnerName = row?.name || null;
  }

  return Response.json({
    ok: true,
    changed: true,
    outcomeStatus: outcome.outcomeStatus,
    winnerPlayerId: outcome.winnerPlayerId,
    winnerName,
    isDraw: !!outcome.isDraw,
    winnerSource: 'wadb'
  });
}
