// GET /api/standings — ladder: games played, wins, win rate per player.
// Draws count toward games played but not toward either player's wins.
export async function onRequestGet(context) {
  const { env } = context;

  const rows = await env.DB.prepare(`
    SELECT
      p.id                                   AS player_id,
      p.name                                 AS name,
      COUNT(DISTINCT gp.game_id)             AS games_played,
      COUNT(DISTINCT CASE WHEN g.winner_player_id = p.id THEN g.id END) AS wins
    FROM players p
    JOIN game_players gp ON gp.player_id = p.id
    JOIN games g ON g.id = gp.game_id
    GROUP BY p.id
  `).all();

  const standings = rows.results.map(r => ({
    playerId: r.player_id,
    name: r.name,
    gamesPlayed: r.games_played,
    wins: r.wins,
    losses: r.games_played - r.wins,
    winRate: r.games_played > 0 ? +(r.wins / r.games_played * 100).toFixed(1) : 0
  }));

  // Win rate first, then total wins as the tiebreaker (a 5-win 100% record
  // outranks a 3-win 100% record), then games played, then name.
  standings.sort((a, b) =>
    b.winRate - a.winRate ||
    b.wins - a.wins ||
    b.gamesPlayed - a.gamesPlayed ||
    a.name.localeCompare(b.name)
  );

  return Response.json(standings);
}