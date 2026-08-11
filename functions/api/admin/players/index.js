import { isAdmin, unauthorized } from '../../../_authAdmin.js';

// GET /api/admin/players — list every player with their aliases and how
// many games they appear in, so the admin panel can offer merge/delete.
export async function onRequestGet(context) {
  const { env, request } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const players = await env.DB.prepare(
    `SELECT p.id, p.name, COUNT(DISTINCT gp.game_id) AS game_count
     FROM players p
     LEFT JOIN game_players gp ON gp.player_id = p.id
     GROUP BY p.id
     ORDER BY p.name COLLATE NOCASE`
  ).all();

  const aliases = await env.DB.prepare(
    `SELECT player_id, alias_text FROM aliases`
  ).all();
  const aliasMap = {};
  for (const a of aliases.results) {
    (aliasMap[a.player_id] ||= []).push(a.alias_text);
  }

  const out = players.results.map(p => ({
    playerId: p.id,
    name: p.name,
    aliases: aliasMap[p.id] || [],
    gameCount: p.game_count
  }));

  return Response.json(out);
}
