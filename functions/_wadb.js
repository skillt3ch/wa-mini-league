// Shared WADB (wormsarmageddon.com) analyzeReplay client — used both by the
// initial submit flow (functions/api/submit.js) and by the admin "Re-check
// WADB" button (functions/api/admin/games/[id]/recheck.js), so a recheck
// runs the exact same logic as the original submission would have.

import { suggestPlayers } from '../public/js/similarity.js';

const WADB_ENDPOINT = 'https://wormsarmageddon.com/api';
// `player { name spectator host }` was added after confirming (via schema
// introspection against the live API) that WADB's Team type resolves an
// authoritative owning Player directly -- engine-resolved, not guessed from
// replay bytes the way public/js/parser.js has to. Used by
// applyWadbIdentityCorrections() below to catch and fix exactly the class
// of bug parser.js can't reliably rule out on its own (a spectator or
// non-owning machine getting mis-attributed as a team's real player).
const WADB_QUERY = `
  mutation ($replay: Upload!) {
    analyzeReplay(replay: $replay) {
      matchComplete
      winningAllianceColor
      teams { name color won player { name spectator host } }
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

// Same score bar the submit page's own dropdown uses to auto-pre-select a
// fuzzy-match suggestion (see public/index.html / public/js/similarity.js).
// Reused here so a first-time discrepancy against a name that's actually
// just an alias variant of someone already registered doesn't spuriously
// create a duplicate player.
const IDENTITY_MATCH_THRESHOLD = 0.6;

// Cross-checks every submitted player's raw name against WADB's own
// team->player resolution and corrects whichever side disagrees: WADB
// actually runs the game engine to resolve this, so on any discrepancy its
// name wins. Mutates `players` in place — rawName always, plus playerId/
// newPlayerName when the correction points at a different identity — so
// the normal player-resolution loop in submit.js (which runs immediately
// after this, and is the only place that actually writes player/alias
// rows) picks up the corrected identity as if it had been submitted that
// way to begin with. Returns the list of corrections made, purely for
// logging (game_audit_log + parser_discrepancies) — callers don't need to
// act on the return value beyond that.
//
// This exists because the local .WAgame parser's team<->machine
// attribution is a byte-signature heuristic with a known failure mode
// (see the long comment in public/js/parser.js): a spectator's machine can
// get mis-attributed as a team's real owner. WADB doesn't have that
// problem — it resolves identity from the actual game engine, including a
// `spectator` flag on the resolved Player, not from reverse-engineered
// replay bytes.
export async function applyWadbIdentityCorrections(env, players, wadbGame) {
  const wadbTeams = wadbGame.teams || [];
  const corrections = [];

  // Only fetch the player/alias list the first time it's actually needed —
  // most submissions won't have any discrepancy, and this would otherwise
  // be two extra queries on every single game submitted.
  let candidates = null;
  async function getCandidates() {
    if (candidates) return candidates;
    const playersRes = await env.DB.prepare(`SELECT id, name FROM players`).all();
    const aliasesRes = await env.DB.prepare(`SELECT player_id, alias_text FROM aliases`).all();
    const aliasMap = {};
    for (const a of aliasesRes.results) (aliasMap[a.player_id] ||= []).push(a.alias_text);
    candidates = playersRes.results.map(p => ({ playerId: p.id, name: p.name, aliases: aliasMap[p.id] || [] }));
    return candidates;
  }

  for (const p of players) {
    const wadbTeam = wadbTeams.find(t => (t.color || '').toUpperCase() === (p.colour || '').toUpperCase());
    const wadbName = wadbTeam?.player?.name?.trim();
    if (!wadbName) continue; // WADB couldn't resolve this team's player either — nothing to compare against

    const localName = (p.rawName || '').trim();
    if (wadbName === localName) continue; // agrees — no correction needed

    // Discrepancy. Resolve wadbName to an existing player the same way the
    // submit page itself would: an exact alias/name match first, then the
    // shared fuzzy suggester, and only create a brand-new player as a last
    // resort. This is deliberately the same logic (and the same module) the
    // client uses, so a WADB-driven correction can't create a duplicate for
    // someone already registered under a slightly different alias.
    const list = await getCandidates();
    let matchedId = null;
    const exact = list.find(c => c.name === wadbName || c.aliases.includes(wadbName));
    if (exact) {
      matchedId = exact.playerId;
    } else {
      const suggestions = suggestPlayers(wadbName, list);
      if (suggestions[0] && suggestions[0].score >= IDENTITY_MATCH_THRESHOLD) matchedId = suggestions[0].playerId;
    }

    corrections.push({
      colour: p.colour,
      oldName: localName,
      newName: wadbName,
      wasUncertain: !!p.identityUncertain,
      wadbSpectator: !!wadbTeam.player.spectator,
      wadbHost: !!wadbTeam.player.host
    });

    if (matchedId) {
      p.playerId = matchedId;
      p.newPlayerName = null;
    } else {
      p.playerId = null;
      p.newPlayerName = wadbName;
    }
    p.rawName = wadbName;
  }

  return corrections;
}
