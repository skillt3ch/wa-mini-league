// POST /api/submit — accepts a replay file + parsed metadata + the
// submitter's player mappings and winner pick, and persists it all.
//
// Expected multipart/form-data fields:
//   file    - the raw .WAgame File
//   meta    - JSON: { playedAt, mapType, durationSeconds, turns, version }
//   players - JSON array in team order:
//               [{ rawName, teamName, colour, shots, turns,
//                  playerId?: number, newPlayerName?: string }]
//             exactly one of playerId / newPlayerName must be set per entry
//   winner  - either the string "draw", or the index (as a string) into
//             the `players` array of the winning team

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { env, request } = context;

  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return Response.json({ error: 'Missing replay file.' }, { status: 400 });
  }

  let meta, players;
  try {
    meta = JSON.parse(form.get('meta') || '{}');
    players = JSON.parse(form.get('players') || '[]');
  } catch {
    return Response.json({ error: 'Malformed meta/players JSON.' }, { status: 400 });
  }
  const winnerField = form.get('winner');

  if (!Array.isArray(players) || players.length < 2) {
    return Response.json({ error: 'Need at least two players.' }, { status: 400 });
  }
  for (const p of players) {
    if (!p.playerId && !p.newPlayerName) {
      return Response.json({ error: `Player "${p.rawName}" was not mapped to a player.` }, { status: 400 });
    }
  }

  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(bytes);

  const existing = await env.DB.prepare(
    `SELECT id FROM games WHERE replay_hash = ?`
  ).bind(hash).first();
  if (existing) {
    return Response.json(
      { error: 'This replay has already been submitted.', gameId: existing.id },
      { status: 409 }
    );
  }

  // Resolve each player entry to a player_id, creating new players/aliases
  // as needed. Every raw in-game name gets recorded as an alias so future
  // submissions with the same variant auto-suggest correctly.
  const resolvedPlayerIds = [];
  for (const p of players) {
    let playerId = p.playerId ? Number(p.playerId) : null;

    if (!playerId) {
      const name = String(p.newPlayerName).trim();
      if (!name) return Response.json({ error: 'New player name cannot be empty.' }, { status: 400 });
      try {
        const res = await env.DB.prepare(
          `INSERT INTO players (name) VALUES (?)`
        ).bind(name).run();
        playerId = res.meta.last_row_id;
      } catch {
        // Name collided with an existing player (unique constraint) — reuse it.
        const row = await env.DB.prepare(`SELECT id FROM players WHERE name = ?`).bind(name).first();
        if (!row) throw new Error('Could not resolve or create player.');
        playerId = row.id;
      }
    }

    if (p.rawName) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO aliases (player_id, alias_text) VALUES (?, ?)`
      ).bind(playerId, p.rawName).run();
    }

    resolvedPlayerIds.push(playerId);
  }

  const isDraw = winnerField === 'draw';
  const winnerIdx = isDraw ? null : Number(winnerField);
  const winnerPlayerId = isDraw ? null : resolvedPlayerIds[winnerIdx];
  if (!isDraw && (winnerIdx == null || Number.isNaN(winnerIdx) || !winnerPlayerId)) {
    return Response.json({ error: 'Invalid winner selection.' }, { status: 400 });
  }

  const r2Key = `replays/${hash}.WAgame`;
  await env.REPLAYS.put(r2Key, bytes);

  const gameRes = await env.DB.prepare(`
    INSERT INTO games
      (played_at, map_type, duration_s, turns, replay_version,
       winner_player_id, is_draw, replay_r2_key, replay_filename, replay_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    meta.playedAt || null,
    meta.mapType ?? null,
    meta.durationSeconds ?? 0,
    meta.turns ?? 0,
    meta.version ?? null,
    winnerPlayerId,
    isDraw ? 1 : 0,
    r2Key,
    file.name || 'replay.WAgame',
    hash
  ).run();
  const gameId = gameRes.meta.last_row_id;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    await env.DB.prepare(`
      INSERT INTO game_players (game_id, player_id, raw_name, team_name, colour, shots, turns)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(gameId, resolvedPlayerIds[i], p.rawName, p.teamName || null, p.colour || null, p.shots || 0, p.turns || 0).run();
  }

  return Response.json({ ok: true, gameId });
}
