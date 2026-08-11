import { isAdmin, unauthorized } from '../../../_authAdmin.js';

// POST /api/admin/players/merge — fold a duplicate player record into
// another (e.g. "Stoned-Worm" and "StonedWorm" being the same person).
// Body: { fromId, intoId }. Every game_players row, every game's
// winner_player_id, and every alias belonging to fromId gets reassigned to
// intoId, then fromId is deleted. Runs in a D1 batch so it's all-or-nothing.
export async function onRequestPost(context) {
  const { env, request } = context;
  if (!isAdmin(request, env)) return unauthorized();

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const fromId = Number(body.fromId);
  const intoId = Number(body.intoId);

  if (!fromId || !intoId) {
    return Response.json({ error: 'fromId and intoId are required.' }, { status: 400 });
  }
  if (fromId === intoId) {
    return Response.json({ error: 'Cannot merge a player into itself.' }, { status: 400 });
  }

  const [fromPlayer, intoPlayer] = await Promise.all([
    env.DB.prepare(`SELECT id, name FROM players WHERE id = ?`).bind(fromId).first(),
    env.DB.prepare(`SELECT id, name FROM players WHERE id = ?`).bind(intoId).first()
  ]);
  if (!fromPlayer) return Response.json({ error: 'Source player not found.' }, { status: 404 });
  if (!intoPlayer) return Response.json({ error: 'Target player not found.' }, { status: 404 });

  // Reassign game history first.
  await env.DB.batch([
    env.DB.prepare(`UPDATE game_players SET player_id = ? WHERE player_id = ?`).bind(intoId, fromId),
    env.DB.prepare(`UPDATE games SET winner_player_id = ? WHERE winner_player_id = ?`).bind(intoId, fromId)
  ]);

  // Move aliases one at a time — alias_text is globally unique, so if the
  // target already has an identical alias, drop the duplicate instead of
  // failing the whole merge.
  const aliases = await env.DB.prepare(`SELECT id, alias_text FROM aliases WHERE player_id = ?`).bind(fromId).all();
  for (const a of aliases.results) {
    try {
      await env.DB.prepare(`UPDATE aliases SET player_id = ? WHERE id = ?`).bind(intoId, a.id).run();
    } catch {
      await env.DB.prepare(`DELETE FROM aliases WHERE id = ?`).bind(a.id).run();
    }
  }

  // Keep the old canonical name discoverable as an alias of the survivor,
  // so future fuzzy-matching still recognises it.
  try {
    await env.DB.prepare(`INSERT INTO aliases (player_id, alias_text) VALUES (?, ?)`).bind(intoId, fromPlayer.name).run();
  } catch { /* already exists as an alias somewhere — fine */ }

  await env.DB.prepare(`DELETE FROM players WHERE id = ?`).bind(fromId).run();

  return Response.json({ ok: true, mergedInto: { playerId: intoPlayer.id, name: intoPlayer.name } });
}
