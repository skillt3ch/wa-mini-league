// GET /api/standings — ladder: games played, wins, win rate, unique
// opponents faced, and an Activity Score, per player. Draws count toward
// games played but not toward either player's wins or losses. Games still
// awaiting an admin's call (outcome_status = 'unresolved', i.e. WADB
// couldn't determine a winner) are excluded entirely until they're
// resolved, so a stuck game doesn't silently deflate anyone's record.
//
// Two separate prizes live here, deliberately kept independent:
//   - Most Wins: the ladder's rank order (total wins, ties broken by win
//     rate, then name). Unique opponents plays no part in the ladder rank
//     itself.
//   - Most Active: a standalone Activity Score = gamesPlayed *
//     uniqueOpponents, rewarding a wide spread of opponents over farming
//     the same one or two people. isActivityLeader flags whoever holds
//     the top score. Small leagues hit exact score ties often enough
//     (e.g. 20 games x 5 opponents = 10 games x 10 opponents = 100) that
//     it needed a tiebreaker — diversity ratio (uniqueOpponents /
//     gamesPlayed) was chosen over "more games" deliberately: games played
//     already gets its due weight inside the score itself, so breaking
//     ties toward it again would quietly turn this into a Most Games prize
//     and undercut the reason the score is multiplicative in the first
//     place. Rewarding diversity on tiebreak instead nudges a small,
//     easily-fragmented player pool toward playing each other, not just
//     the same one or two people. A genuine tie on both dimensions still
//     shares the flag.
export async function onRequestGet(context) {
  const { env } = context;

  // last_played_epoch is computed via strftime('%s', ...) rather than a
  // raw string MAX(): played_at (client-supplied ISO, e.g.
  // "...T14:30:00.000Z") and submitted_at (D1's datetime('now'), e.g.
  // "...14:30:00" with a space, no 'Z') are two different string shapes
  // for the same moment. A lexicographic MAX/COALESCE across the two
  // isn't reliable — SQLite's strftime() parses both shapes correctly and
  // compares them as actual UTC instants instead.
  const rows = await env.DB.prepare(`
    SELECT
      p.id                                   AS player_id,
      p.name                                 AS name,
      COUNT(DISTINCT gp.game_id)             AS games_played,
      COUNT(DISTINCT CASE WHEN g.winner_player_id = p.id THEN g.id END) AS wins,
      COUNT(DISTINCT CASE WHEN g.is_draw = 1 THEN g.id END) AS draws,
      COUNT(DISTINCT opp.player_id)          AS unique_opponents,
      MAX(strftime('%s', COALESCE(g.played_at, g.submitted_at))) AS last_played_epoch
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
    uniqueOpponents: r.unique_opponents,
    lastPlayedAt: r.last_played_epoch ? new Date(r.last_played_epoch * 1000).toISOString() : null,
    activityScore: r.games_played * r.unique_opponents,
    diversityRatio: r.games_played > 0 ? +(r.unique_opponents / r.games_played).toFixed(4) : 0
  }));

  // Most Wins ranking: total wins first, win rate as the tiebreaker
  // (rewards efficiency over volume when wins are tied), then name as a
  // last resort for a genuine dead heat. Unique opponents plays no part in
  // this sort — that's scored separately as Most Active.
  standings.sort((a, b) =>
    b.wins - a.wins ||
    b.winRate - a.winRate ||
    a.name.localeCompare(b.name)
  );

  const topActivityScore = Math.max(0, ...standings.map(s => s.activityScore));
  const tiedOnScore = standings.filter(s => topActivityScore > 0 && s.activityScore === topActivityScore);
  const topDiversityRatioAmongTied = Math.max(0, ...tiedOnScore.map(s => s.diversityRatio));
  for (const s of standings) {
    s.isActivityLeader =
      topActivityScore > 0 &&
      s.activityScore === topActivityScore &&
      s.diversityRatio === topDiversityRatioAmongTied;
  }

  return Response.json(standings);
}
