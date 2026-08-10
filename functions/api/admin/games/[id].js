import { isAdmin, unauthorized } from '../../../_authAdmin.js';

// PATCH /api/admin/games/:id — edit winner / draw flag for a submission.
// Body: { winnerPlayerId: number|null, isDraw: boolean }
export async function onRequestPatch(context) {
  const { env, request, params } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const id = Number(params.id);
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const game = await env.DB.prepare(`SELECT id FROM games WHERE id = ?`).bind(id).first();
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

  await env.DB.prepare(
    `UPDATE games SET winner_player_id = ?, is_draw = ? WHERE id = ?`
  ).bind(winnerPlayerId, isDraw ? 1 : 0, id).run();

  return Response.json({ ok: true });
}

// DELETE /api/admin/games/:id — remove a submission entirely (and its
// stored replay file). game_players rows cascade via the FK.
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
