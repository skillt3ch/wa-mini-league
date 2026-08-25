// GET /api/standings — ladder: games played, wins, win rate, unique
// opponents faced, per player. Draws count toward games played but not
// toward either player's wins or losses. Games still awaiting an admin's
// call (outcome_status = 'unresolved', i.e. WADB couldn't determine a
// winner) are excluded entirely until they're resolved, so a stuck game
// doesn't silently deflate anyone's record.
export async function onRequestGet(context) {
  const { env } = context;

  const rows = await env.DB.prepare(`
    SELECT
      p.id                                   AS player_id,
      p.name                                 AS name,
      COUNT(DISTINCT gp.game_id)             AS games_played,
      COUNT(DISTINCT CASE WHEN g.winner_player_id = p.id THEN g.id END) AS wins,
      COUNT(DISTINCT CASE WHEN g.is_draw = 1 THEN g.id END) AS draws,
      COUNT(DISTINCT opp.player_id)          AS unique_opponents
    FROM players p
    JOIN game_players gp ON gp.player_id = p.id
    JOIN games g ON g.id = gp.game_id
    LEFT JOIN game_players opp ON opp.game_id = gp.game_id AND opp.player_id != p.id
    WHERE g.outcome_status != 'unresolved'
    GROUP BY p.id
  `).all();

  const standings = rows.results.map(r => ({
    playerId: r.player_id,
    name: r.name,
    gamesPlayed: r.games_played,
    wins: r.wins,
    draws: r.draws,
    losses: r.games_played - r.wins - r.draws,
    winRate: r.games_played > 0 ? +(r.wins / r.games_played * 100).toFixed(1) : 0,
    uniqueOpponents: r.unique_opponents
  }));

  // Total wins first. Ties broken by games played (rewards showing up),
  // then by unique opponents faced (rewards playing a wider pool of
  // people over farming wins against the same one or two opponents),
  // then name as a last resort for a genuine dead heat. Win rate is no
  // longer part of the sort — it's still shown on the ladder, but a
  // 1-game 100% record no longer outranks someone with a real track
  // record.
  standings.sort((a, b) =>
    b.wins - a.wins ||
    b.gamesPlayed - a.gamesPlayed ||
    b.uniqueOpponents - a.uniqueOpponents ||
    a.name.localeCompare(b.name)
  );

  return Response.json(standings);
}
