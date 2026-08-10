/* ============================================================
   Name matching for player identity across replays.

   Problem: the same person shows up in replays as "dt-Deano",
   "Deano", "dt-Daeno" etc — clan tags get added/dropped, and
   typos happen. This never has to be perfect: it only produces a
   *suggestion* pre-selected in a dropdown that the submitter can
   always override, and every confirmed mapping gets saved as a new
   alias, so match quality improves over time as more variants of
   each player's name are seen.
   ============================================================ */

// Lowercase, strip anything that isn't a letter/digit.
function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Clan tags are usually a short prefix or suffix joined by a separator
// (-, _, [], |, .), e.g. "dt-Deano", "[dt]Deano", "Deano.dt". Pull out
// every hyphen/underscore/bracket/pipe/dot-delimited segment so the
// "core" part of the name (the longest segment) can be compared too —
// that's usually the part that stays stable across renames.
function segments(raw) {
  const parts = (raw || '')
    .split(/[-_\[\]|.\s]+/)
    .map(normalize)
    .filter(Boolean);
  return parts.length ? parts : [normalize(raw)];
}

function coreSegment(raw) {
  const parts = segments(raw);
  return parts.reduce((a, b) => (b.length > a.length ? b : a), parts[0] || '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/**
 * candidates: [{ playerId, name, aliases: string[] }]
 * Returns candidates sorted best-first, each with a 0..1 `score`.
 */
export function suggestPlayers(rawName, candidates) {
  const rawNorm = normalize(rawName);
  const rawCore = coreSegment(rawName);

  const scored = candidates.map(c => {
    const texts = [c.name, ...(c.aliases || [])];
    let best = 0;
    for (const t of texts) {
      const tNorm = normalize(t);
      if (tNorm === rawNorm) { best = 1; break; }
      const full = similarity(rawNorm, tNorm);
      const core = similarity(rawCore, coreSegment(t));
      // Core-segment match weighted highest — that's the part clan tags
      // usually don't touch — full-string similarity as a fallback signal.
      const score = Math.max(full, core * 0.95, tNorm.includes(rawCore) || rawNorm.includes(tNorm) ? 0.85 : 0);
      if (score > best) best = score;
    }
    return { ...c, score: best };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export { normalize, coreSegment };
