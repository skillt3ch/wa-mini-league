import { isAdmin, unauthorized } from '../../../_authAdmin.js';

// PATCH /api/admin/reports/:id — toggle open/resolved. Body: { status }
export async function onRequestPatch(context) {
  const { env, request, params } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const id = Number(params.id);
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const status = body.status === 'resolved' ? 'resolved' : 'open';

  const report = await env.DB.prepare(`SELECT id FROM reports WHERE id = ?`).bind(id).first();
  if (!report) return Response.json({ error: 'Report not found.' }, { status: 404 });

  await env.DB.prepare(`UPDATE reports SET status = ? WHERE id = ?`).bind(status, id).run();
  return Response.json({ ok: true });
}

// DELETE /api/admin/reports/:id — remove a report entirely.
export async function onRequestDelete(context) {
  const { env, request, params } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const id = Number(params.id);
  const report = await env.DB.prepare(`SELECT id FROM reports WHERE id = ?`).bind(id).first();
  if (!report) return Response.json({ error: 'Report not found.' }, { status: 404 });

  await env.DB.prepare(`DELETE FROM reports WHERE id = ?`).bind(id).run();
  return Response.json({ ok: true });
}
