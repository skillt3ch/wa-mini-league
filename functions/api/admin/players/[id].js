import { isAdmin, unauthorized } from '../../../_authAdmin.js';

// DELETE /api/admin/players/:id — remove a player outright. Only allowed
// when the player has zero games attached (otherwise deleting would orphan
// game_players rows / silently rewrite history) — merge into another
// player instead if games exist.
export async function onRequestDelete(context) {
  const { env, request, params } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const id = Number(params.id);
  const player = await env.DB.prepare(`SELECT id FROM players WHERE id = ?`).bind(id).first();
  if (!player) return Response.json({ error: 'Player not found.' }, { status: 404 });

  const { count } = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM game_players WHERE player_id = ?`
  ).bind(id).first();
  if (count > 0) {
    return Response.json(
      { error: `This player appears in ${count} game${count === 1 ? '' : 's'}. Merge into another player instead of deleting.` },
      { status: 409 }
    );
  }

  await env.DB.prepare(`DELETE FROM aliases WHERE player_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM players WHERE id = ?`).bind(id).run();

  return Response.json({ ok: true });
}
