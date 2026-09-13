// Single source of truth for when this league's submission window closes.
// Mirrored client-side in public/js/leagueEnd.js — both files hardcode the
// same instant rather than one fetching the other, since this is a one-time
// value for a short-lived league, not something that needs a DB row. If the
// deadline ever changes, update BOTH files.
//
// This is the *authoritative* check: submit.js enforces this server-side
// regardless of what the client shows, so a stale page/clock never lets a
// late submission through.
export const LEAGUE_ENDS_AT = '2026-09-13T10:05:00Z';

export function leagueHasEnded() {
  return Date.now() >= new Date(LEAGUE_ENDS_AT).getTime();
}
