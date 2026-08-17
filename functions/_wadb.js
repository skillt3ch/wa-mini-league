// Shared WADB (wormsarmageddon.com) analyzeReplay client — used both by the
// initial submit flow (functions/api/submit.js) and by the admin "Re-check
// WADB" button (functions/api/admin/games/[id]/recheck.js), so a recheck
// runs the exact same logic as the original submission would have.

const WADB_ENDPOINT = 'https://wormsarmageddon.com/api';
const WADB_QUERY = `
  mutation ($replay: Upload!) {
    analyzeReplay(replay: $replay) {
      matchComplete
      winningAllianceColor
      teams { name color won }
    }
  }
`;

// Calls the WADB analyzeReplay mutation. Returns { ok: true, game } on a
// clean GraphQL response, or { ok: false, reason } if the call failed or
// returned GraphQL errors — callers treat that as "couldn't verify", not
// as a reason to reject the submission outright.
export async function callWadb(bytes, filename) {
  try {
    const fd = new FormData();
    fd.set('operations', JSON.stringify({ query: WADB_QUERY, variables: { replay: null } }));
    fd.set('map', JSON.stringify({ '0': ['variables.replay'] }));
    fd.set('0', new Blob([bytes]), filename || 'replay.WAgame');

    const res = await fetch(WADB_ENDPOINT, { method: 'POST', body: fd });
    if (!res.ok) return { ok: false, reason: `WADB returned HTTP ${res.status}` };

    const json = await res.json();
    if (json.errors?.length) return { ok: false, reason: json.errors[0]?.message || 'WADB reported an error' };
    if (!json.data?.analyzeReplay) return { ok: false, reason: 'WADB returned no game data' };

    return { ok: true, game: json.data.analyzeReplay };
  } catch (err) {
    return { ok: false, reason: 'Could not reach WADB: ' + (err?.message || err) };
  }
}

// Turns a WADB game result + our resolved player list into an outcome.
// players[i].colour is our locally-parsed team colour name (e.g. "Magenta");
// WADB's team.color is an uppercase enum (e.g. "MAGENTA") — compare
// case-insensitively.
export function resolveOutcome(wadbGame, players, resolvedPlayerIds) {
  if (!wadbGame.matchComplete) {
    return {
      outcomeStatus: 'unresolved', winnerSource: null, winnerPlayerId: null, isDraw: 0,
      note: 'WADB reported the match as not complete (aborted or interrupted game).'
    };
  }

  const winners = (wadbGame.teams || []).filter(t => t.won === true);

  if (winners.length === 0) {
    return { outcomeStatus: 'draw', winnerSource: 'wadb', winnerPlayerId: null, isDraw: 1, note: null };
  }

  if (winners.length === 1) {
    const idx = players.findIndex(p => (p.colour || '').toUpperCase() === (winners[0].color || '').toUpperCase());
    if (idx !== -1) {
      return { outcomeStatus: 'confirmed', winnerSource: 'wadb', winnerPlayerId: resolvedPlayerIds[idx], isDraw: 0, note: null };
    }
    return {
      outcomeStatus: 'unresolved', winnerSource: null, winnerPlayerId: null, isDraw: 0,
      note: `WADB reported the winning colour as "${winners[0].color}", but no submitted player was mapped to that colour.`
    };
  }

  // Multiple winners — alliance mode, most likely.
  return {
    outcomeStatus: 'unresolved', winnerSource: null, winnerPlayerId: null, isDraw: 0,
    note: `WADB reported ${winners.length} winning teams (likely alliance mode) — can't auto-assign a single winner.`
  };
}
