// GET /api/games — chronological list of submitted games, each with its
// players, winner, and a download link for the stored replay.
export async function onRequestGet(context) {
  const { env } = context;

  const games = await env.DB.prepare(`
    SELECT g.id, g.played_at, g.duration_s, g.turns, g.is_draw,
           g.replay_filename, g.replay_hash, g.submitted_at,
           g.winner_player_id AS winner_player_id,
           g.outcome_status AS outcome_status,
           g.winner_source AS winner_source,
           g.wadb_slug AS wadb_slug,
           winner.name AS winner_name
    FROM games g
    LEFT JOIN players winner ON winner.id = g.winner_player_id
    ORDER BY COALESCE(g.played_at, g.submitted_at) DESC, g.id DESC
  `).all();

  const gamePlayers = await env.DB.prepare(`
    SELECT gp.game_id, gp.raw_name, gp.team_name, gp.colour, gp.shots, gp.turns,
           p.id AS player_id, p.name AS player_name
    FROM game_players gp
    JOIN players p ON p.id = gp.player_id
  `).all();

  const byGame = {};
  for (const gp of gamePlayers.results) {
    (byGame[gp.game_id] ||= []).push({
      playerId: gp.player_id,
      playerName: gp.player_name,
      rawName: gp.raw_name,
      teamName: gp.team_name,
      colour: gp.colour,
      shots: gp.shots,
      turns: gp.turns
    });
  }

  const out = games.results.map(g => ({
    id: g.id,
    playedAt: g.played_at,
    durationSeconds: g.duration_s,
    turns: g.turns,
    isDraw: !!g.is_draw,
    winnerPlayerId: g.winner_player_id,
    winnerName: g.winner_name,
    outcomeStatus: g.outcome_status,
    winnerSource: g.winner_source,
    wadbUrl: g.wadb_slug ? `https://wormsarmageddon.com/games/${g.wadb_slug}` : null,
    replayFilename: g.replay_filename,
    replayDownloadUrl: `/api/replay/${g.replay_hash}`,
    submittedAt: g.submitted_at,
    players: byGame[g.id] || []
  }));

  return Response.json(out);
}
