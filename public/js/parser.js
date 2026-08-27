/* ============================================================
   .WAgame parser — ported from the dreamwa.re "Replay Reader" tool.
   Trimmed to what the mini-league needs: teams, player/machine
   attribution, per-team stats, duration, turns, map/version/date.
   Flag/grave image extraction and chat parsing are intentionally
   dropped here (not needed for submission) — see the original
   replay.html tool if that's ever wanted back.

   All parsing behaviour (team/machine matching rules, signature-based
   detection instead of hardcoded offsets, etc.) is unchanged from the
   original — see inline comments for the "why" on the trickier bits.
   ============================================================ */

const TEAM_COLOURS = [
  {n:'Red',    hex:'#DE4343'}, {n:'Blue',  hex:'#4A6FE0'},
  {n:'Green',  hex:'#4FBF52'}, {n:'Yellow',hex:'#E0BE2C'},
  {n:'Magenta',hex:'#C555C0'}, {n:'Cyan',  hex:'#4FC3C9'}
];

const FIXED = {0x00:0,0x02:0,0x06:1,0x08:8,0x09:4,0x0C:5,0x0D:2,0x11:5,0x12:2,0x13:2,
 0x16:1,0x17:0,0x1A:1,0x1B:1,0x1E:1,0x1F:1,0x20:1,0x21:1,0x24:1,0x25:1,0x26:1,0x27:1,
 0x2B:1,0x2C:1,0x2D:1,0x2E:1,0x2F:2,0x30:2,0x31:2,0x32:7,0x33:3,0x3A:0,0x43:1,0x62:1,
 0x6B:5,0x6C:0,0x6D:2,0x74:4};
const TEAM_EV = new Set([0x11,0x12,0x13,0x1A,0x1E,0x1F,0x20,0x21,0x24,0x25,0x26,0x27,
 0x2C,0x2D,0x2E,0x43,0x62]);
const END_REASON = {0:'Quit with Alt+F4',1:'Player quit',2:'Draw',3:'Ended normally'};

const PAL = 1024;
const FLAG_W = 20, FLAG_H = 17, FLAG_PXN = FLAG_W * FLAG_H;
const GRAVE_W = 24, GRAVE_H = 32, GRAVE_PXN = GRAVE_W * GRAVE_H;
const FLAG_BLOCK = PAL + FLAG_PXN;
const GRAVE_BLOCK = PAL + GRAVE_PXN;

// Names are single-byte Latin-1/Windows-1252, not CP437 — see replay.html
// for the byte-verified reasoning. Straight byte decode.
const latin1 = bytes => Array.from(bytes, b => String.fromCharCode(b)).join('');

export function parseWAGame(buf) {
  const d = new Uint8Array(buf), dv = new DataView(buf);
  const u16 = o => dv.getUint16(o, true), u32 = o => dv.getUint32(o, true);

  if (d[0] !== 0x57 || d[1] !== 0x41)
    throw new Error("That is not a .WAgame file - it should start with the bytes 'WA'.");

  const version = u16(2);
  const mapLen = u32(4);
  const mapType = u32(8);
  const mapEnd = 8 + mapLen;

  let date = null;
  const floor = 1041379200, ceil = Math.floor(Date.now() / 1000) + 31536000;
  for (let i = mapEnd; i < Math.min(mapEnd + 128, d.length - 6); i++) {
    if (u16(i) === version) {
      const t = u32(i + 2);
      if (t > floor && t < ceil) { date = new Date(t * 1000); break; }
    }
  }

  function isPaletteShaped(o) {
    if (o < 0 || o + PAL > d.length) return false;
    let nz = 0;
    for (let k = 0; k < PAL; k += 4) {
      if (d[o + k + 3] !== 0x00) return false;
      if (d[o + k] || d[o + k + 1] || d[o + k + 2]) nz++;
    }
    return nz >= 1;
  }
  function allZero(o, n) {
    if (o < 0 || o + n > d.length) return false;
    for (let i = o; i < o + n; i++) if (d[i] !== 0) return false;
    return true;
  }
  function findBlock(end) {
    for (let g = -1; g <= 24; g++) {
      const gap = (g === -1) ? 6 : g;
      if (g >= 0 && gap === 6) continue;
      const S = end + gap;
      let flag, grave;
      if (allZero(S, FLAG_BLOCK)) flag = null;
      else if (isPaletteShaped(S)) flag = S;
      else continue;
      const G = S + FLAG_BLOCK;
      if (allZero(G, GRAVE_BLOCK)) grave = null;
      else if (isPaletteShaped(G)) grave = G;
      else continue;
      return { flag, grave, blockEnd: G + GRAVE_BLOCK };
    }
    return null;
  }

  function pstr(o, asciiOnly) {
    if (o >= d.length) return null;
    const L = d[o];
    if (L < 1 || L > 20 || o + 1 + L > d.length) return null;
    for (let k = 1; k <= L; k++) {
      if (d[o + k] < 0x20 || d[o + k] === 0x7f) return null;
      if (asciiOnly && d[o + k] > 0x7E) return null;
    }
    return d.subarray(o + 1, o + 1 + L);
  }
  function tryTeam(o) {
    let p = o; const names = [];
    for (let k = 0; k < 9; k++) {
      const s = pstr(p, false); if (!s) return null;
      names.push(s); p += 1 + s.length;
    }
    if (d[p] !== 0x00 && d[p] !== 0x01) return null;
    const sb = pstr(p + 1, false); if (!sb) return null;
    p += 2 + sb.length;
    const cands = [];
    if (d[p] === 0x00 || d[p] === 0x01) {
      const fan = pstr(p + 1, false);
      if (fan) cands.push({ end: p + 2 + fan.length, sb, fan });
    }
    cands.push({ end: p, sb, fan: null });
    for (const c of cands) {
      const blk = findBlock(c.end);
      if (blk) return { start: o, end: c.end, name: names[0], worms: names.slice(1), ...blk };
    }
    return null;
  }

  const teams = [];
  for (let i = mapEnd; i < d.length;) {
    const t = tryTeam(i);
    if (t) {
      teams.push({
        name: latin1(t.name),
        worms: t.worms.map(w => latin1(w)),
        slot: d[t.start - 3],
        colourIdx: d[t.start - 2],
        machineIdx: null,
        identityUncertain: false,
        start: t.start,
        blockEnd: t.blockEnd
      });
      i = t.blockEnd;
    } else i++;
  }
  if (!teams.length) throw new Error("No team records found. The file may be truncated or use an unsupported replay format version.");

  const usedCol = new Set();
  teams.forEach(t => {
    let c = t.colourIdx;
    if (c > 5 || usedCol.has(c)) {
      c = 0; while (c < 6 && usedCol.has(c)) c++;
    }
    usedCol.add(c);
    t.colourIdx = c;
    t.colour = TEAM_COLOURS[c] || { n: '#' + c, hex: '#8FA3AE' };
  });

  // Machines (players) — see replay.html for the full reasoning behind
  // "appearance order paired with ascending team-slot" being the only rule
  // that survives drops/reconnects and non-contiguous slot numbers.
  const machines = [];
  const hi = teams[0].start;
  const machineStarts = [];
  let schm = -1;
  for (let i = mapEnd; i < d.length - 4; i++)
    if (d[i] === 0x53 && d[i + 1] === 0x43 && d[i + 2] === 0x48 && d[i + 3] === 0x4D) { schm = i; break; }
  for (let i = (schm >= 0 ? schm : mapEnd); i < hi;) {
    if (d[i] === 1) {
      const s = pstr(i + 1, true);
      if (s && s.length >= 2) {
        machines.push({ name: latin1(s) });
        machineStarts.push({ nameLenAt: i + 1, markEnd: i + 2 + s.length });
        i += 2 + s.length; continue;
      }
    }
    i++;
  }
  machineStarts.forEach((ms, k) => {
    const end = machineStarts[k + 1] ? machineStarts[k + 1].nameLenAt : hi;
    let country = null, hasTeam = false;
    for (let i = ms.markEnd; i < end - 8; i++) {
      if (d[i] === 7 && d[i + 1] === 2 && d[i + 2] === 1 && d[i + 3] >= 65 && d[i + 3] <= 90 && d[i + 4] >= 65 && d[i + 4] <= 90) {
        country = String.fromCharCode(d[i + 3], d[i + 4]);
      }
      if (d[i] === 4 && d[i + 1] === 5 && d[i + 6] === 0x00) hasTeam = true;
    }
    machines[k].country = country;
    machines[k].hasTeam = hasTeam;
    machines[k].slotId = k;
  });

  // Team <-> machine attribution. Every approach tried so far — treating a
  // team's `slot` byte as a direct index into `machines`, or the original
  // dreamwa.re rank-pairing (sort teams by slot, sort `hasTeam`-flagged
  // machines by appearance order, zip them) — has been proven wrong by a
  // real submitted replay, and not just "fails to resolve": both can
  // silently produce a confidently *wrong* answer, which is worse than not
  // resolving at all. Three real examples:
  //
  //  - A real player's team was stored as slot=3 while only 3 machines
  //    (indices 0-2) were connected at all — direct-indexing had nothing
  //    valid to find, rank-pairing shifted a spectator into the second
  //    real player's place instead.
  //  - A genuine spectator's machine carried the exact same `hasTeam`
  //    byte-signature as the host and the real opponent — the signature
  //    fires on connected machines generally, not specifically on ones
  //    that own a team, so it can't be trusted to exclude spectators at
  //    all, in either approach above.
  //  - Worse: a real player's team had slot=3, and a *different*,
  //    non-owning machine (a spectator, also `hasTeam`-flagged) happened
  //    to sit at array index 3 — direct-indexing "succeeded" (a valid,
  //    hasTeam-flagged machine really was at that index) and confidently
  //    credited the spectator instead of the real player, who was
  //    connected at a different index entirely. A clean direct-link hit
  //    is therefore not proof of correctness — it can be pure
  //    coincidence.
  //
  // Given hasTeam doesn't reliably exclude non-owners and slot/array-index
  // alignment is coincidental whenever a non-owning machine (a spectator,
  // or a host who isn't also playing) is connected, there's no local
  // signal left to trust *at all* once one exists. So: only resolve teams
  // locally when there's no non-owner to possibly get confused with — i.e.
  // every connected machine owns exactly one team (machines.length ===
  // teams.length) — in which case pairing by rank (sorted by slot,
  // zipped with appearance order) is safe simply because there's no one
  // else it could be. The moment even one non-owning machine is present,
  // every team is left unresolved (identityUncertain) rather than guessed.
  // playersFromParsed() falls back to the team's own name in that case
  // (always correct — spectators never get team records at all); the
  // submission UI asks the submitter to confirm or correct every such
  // player, and — more importantly — the backend cross-checks every
  // submission against WADB's own engine-resolved player identity
  // (see applyWadbIdentityCorrections in functions/_wadb.js) and corrects
  // it there regardless of what happened locally. That server-side check
  // is the real safety net now; this local heuristic is best-effort only.
  if (machines.length === teams.length) {
    const bySlot = teams.map((t, idx) => idx).sort((a, b) => teams[a].slot - teams[b].slot);
    bySlot.forEach((teamIdx, i) => { teams[teamIdx].machineIdx = i; });
  } else {
    teams.forEach(t => { t.identityUncertain = true; });
  }

  // Event stream — used only for per-team shot/turn counts and overall
  // duration/turn count here (chat + weapon breakdowns dropped).
  function walk(start, collect) {
    let i = start, frame = 0;
    const ev = [];
    while (i < d.length) {
      const op = d[i];
      if (op === 0x02) { frame++; i++; continue; }
      if (op === 0x0F) {
        let j = i + 4; while (j < d.length && d[j] !== 0) j++;
        if (j >= d.length) return null;
        if (collect) ev.push({ f: frame, op, a: d.subarray(i + 1, j + 1) });
        i = j + 1; continue;
      }
      if (op >= 0x70 && op <= 0x73) {
        if (i + 3 >= d.length) return null;
        if (collect) ev.push({ f: frame, op, a: d.subarray(i + 1, i + 4) });
        i += 4 + d[i + 2]; continue;
      }
      const n = FIXED[op];
      if (n === undefined) return null;
      if (collect) ev.push({ f: frame, op, a: d.subarray(i + 1, i + 1 + n) });
      i += 1 + n;
    }
    return i === d.length ? { events: ev, frames: frame } : null;
  }
  let stream = null;
  const from = teams[teams.length - 1].blockEnd;
  for (let c = from; c < d.length; c++) {
    if (d[c] !== 0x09) continue;
    const r = walk(c, false);
    if (r && r.frames > 100) { stream = walk(c, true); break; }
  }
  if (!stream) throw new Error("Could not locate the event stream. The replay may use an event this reader doesn't know yet.");

  const per = teams.map(() => ({ shots: 0, turns: 0 }));
  const turns = [];
  let cur = null, endReason = null;
  for (const e of stream.events) {
    const { op, a, f } = e;
    if (TEAM_EV.has(op)) {
      const t = a[0] - 1;
      if (a[0] !== cur) {
        if (cur !== null && turns.length) turns[turns.length - 1].end = f;
        turns.push({ team: a[0], start: f, end: f });
        cur = a[0];
        if (per[t]) per[t].turns++;
      } else if (turns.length) turns[turns.length - 1].end = f;
      if (per[t] && op === 0x26) per[t].shots++;
    }
    if (op === 0x16) endReason = a[0];
  }
  if (turns.length) turns[turns.length - 1].end = stream.frames;

  // Player attribution — machine when resolvable, else fall back to team name.
  teams.forEach(t => { t.machine = (t.machineIdx != null) ? machines[t.machineIdx] : null; });

  return {
    version, mapType, mapLen, date,
    teams, machines, per,
    endReason: endReason !== null ? (END_REASON[endReason] || String(endReason)) : null,
    turns: turns.length,
    frames: stream.frames,
    durationSeconds: Math.round(stream.frames / 50)
  };
}

/** Convenience: flat list of {rawName, teamName, colour, shots, turns, identityUncertain} for submission UI. */
export function playersFromParsed(r) {
  return r.teams.map((t, i) => ({
    rawName: t.machine ? t.machine.name : t.name,
    teamName: t.name,
    colour: t.colour.n,
    shots: r.per[i].shots,
    turns: r.per[i].turns,
    // true when the parser couldn't confidently tell which connected
    // machine controlled this team (see the attribution comment above) —
    // rawName falls back to the team's own name in that case, which is
    // always accurate but isn't necessarily the player's usual handle, so
    // the submission UI should prompt for manual confirmation instead of
    // trusting a fuzzy-match auto-suggestion against it.
    identityUncertain: !!t.identityUncertain
  }));
}
