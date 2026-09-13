// Single source of truth for when this league's submission window closes,
// client side. Mirrored server-side in functions/_league.js — that copy is
// the authoritative one (submit.js enforces it regardless of what a client
// shows), this one is just for the countdown banner / disabling the submit
// UI so people aren't surprised when the server rejects a late upload. If
// the deadline ever changes, update BOTH files.
export const LEAGUE_ENDS_AT = '2026-09-13T10:05:00Z';

export function leagueHasEnded() {
  return Date.now() >= new Date(LEAGUE_ENDS_AT).getTime();
}

// Renders a live "closes in HH:MM:SS" countdown into `el`, flipping it to a
// static "closed" message once the deadline passes. Returns the interval id
// (rarely needed — pages don't currently stop it early) in case a caller
// ever wants to clear it, e.g. on navigation away in an SPA-like context.
export function renderCountdown(el, { onEnd } = {}) {
  let firedEnd = false;
  // Declared (not just assigned) before tick() ever runs: tick() references
  // `id` in its already-ended branch, and it's called once synchronously
  // below before the interval is created. If the deadline has already
  // passed at render time (true from the moment the league ends onward),
  // that first synchronous call hit `id` while it was still a TDZ `const`,
  // throwing "Cannot access 'id' before initialization" and killing this
  // entire module script — including everything after this call on the
  // page (standings/games fetches, admin login wiring). `let id` declared
  // up front avoids the TDZ regardless of call order.
  let id;
  function tick() {
    const diff = new Date(LEAGUE_ENDS_AT).getTime() - Date.now();
    if (diff <= 0) {
      el.textContent = 'League closed — submissions are no longer accepted. Final standings are locked in.';
      el.classList.add('ended');
      clearInterval(id);
      if (!firedEnd) {
        firedEnd = true;
        if (typeof onEnd === 'function') onEnd();
      }
      return;
    }
    const totalSeconds = Math.floor(diff / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = n => String(n).padStart(2, '0');
    el.textContent = `League closes in ${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  tick();
  id = setInterval(tick, 1000);
  return id;
}
