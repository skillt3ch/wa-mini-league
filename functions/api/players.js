// GET /api/players — list all known players with their aliases.
// Used client-side by the submit page to power fuzzy-match suggestions.
export async function onRequestGet(context) {
  const { env } = context;
  const players = await env.DB.prepare(
    `SELECT id, name FROM players ORDER BY name COLLATE NOCASE`
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
    aliases: aliasMap[p.id] || []
  }));

  return Response.json(out);
}
