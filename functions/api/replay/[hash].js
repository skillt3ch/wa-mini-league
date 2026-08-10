// GET /api/replay/:hash — stream the stored .WAgame file back for download.
export async function onRequestGet(context) {
  const { env, params } = context;
  const hash = params.hash;

  const row = await env.DB.prepare(
    `SELECT replay_r2_key, replay_filename FROM games WHERE replay_hash = ?`
  ).bind(hash).first();

  if (!row) return new Response('Replay not found', { status: 404 });

  const obj = await env.REPLAYS.get(row.replay_r2_key);
  if (!obj) return new Response('Replay file missing from storage', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${row.replay_filename.replace(/"/g, '')}"`
    }
  });
}
