import { isAdmin, unauthorized } from '../../../_authAdmin.js';
import { logGameAudit } from '../../../_gameAudit.js';

function adminIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';
}

// PATCH /api/admin/games/:id — edit winner / draw flag for a submission.
// Body: { winnerPlayerId: number|null, isDraw: boolean }
export async function onRequestPatch(context) {
  const { env, request, params } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const id = Number(params.id);
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const game = await env.DB.prepare(
    `SELECT id, winner_player_id, is_draw, outcome_status, winner_source FROM games WHERE id = ?`
  ).bind(id).first();
  if (!game) return Response.json({ error: 'Game not found.' }, { status: 404 });

  const isDraw = !!body.isDraw;
  const winnerPlayerId = isDraw ? null : (body.winnerPlayerId ? Number(body.winnerPlayerId) : null);

  if (!isDraw && !winnerPlayerId) {
    return Response.json({ error: 'Must provide winnerPlayerId unless isDraw is true.' }, { status: 400 });
  }
  if (winnerPlayerId) {
    const belongs = await env.DB.prepare(
      `SELECT 1 FROM game_players WHERE game_id = ? AND player_id = ?`
    ).bind(id, winnerPlayerId).first();
    if (!belongs) {
      return Response.json({ error: 'winnerPlayerId must be one of the players in this game.' }, { status: 400 });
    }
  }

  // A manual edit always resolves the game — even correcting a WADB-verified
  // result counts as an admin override from here on.
  const outcomeStatus = isDraw ? 'draw' : 'confirmed';
  await env.DB.prepare(
    `UPDATE games SET winner_player_id = ?, is_draw = ?, outcome_status = ?, winner_source = 'manual' WHERE id = ?`
  ).bind(winnerPlayerId, isDraw ? 1 : 0, outcomeStatus, id).run();

  // Every admin edit is logged — before/after values plus the admin's IP —
  // so nothing about a game's result can change without a visible trail.
  await logGameAudit(env, {
    gameId: id,
    action: 'winner_edit',
    actor: 'admin',
    adminIp: adminIp(request),
    before: { winnerSource: game.winner_source, winnerPlayerId: game.winner_player_id, isDraw: !!game.is_draw, outcomeStatus: game.outcome_status },
    after: { winnerSource: 'manual', winnerPlayerId, isDraw, outcomeStatus }
  });

  return Response.json({ ok: true });
}

// DELETE /api/admin/games/:id — remove a submission entirely (and its
// stored replay file). game_players and game_audit_log rows both cascade
// via their FK — there's no separate "deletion" audit entry, since once
// the game is gone there's nothing left to view a trail against.
export async function onRequestDelete(context) {
  const { env, request, params } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const id = Number(params.id);
  const game = await env.DB.prepare(
    `SELECT replay_r2_key FROM games WHERE id = ?`
  ).bind(id).first();
  if (!game) return Response.json({ error: 'Game not found.' }, { status: 404 });

  await env.DB.prepare(`DELETE FROM games WHERE id = ?`).bind(id).run();
  await env.REPLAYS.delete(game.replay_r2_key);

  return Response.json({ ok: true });
}
