import { isAdmin, unauthorized } from '../../../../_authAdmin.js';
import { getGameAuditLog } from '../../../../_gameAudit.js';

// GET /api/admin/games/:id/history — full audit trail for one game
// (submission, admin edits, WADB rechecks), oldest first. Admin-only since
// it includes the IP address of whichever admin made each change.
export async function onRequestGet(context) {
  const { env, request, params } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const id = Number(params.id);
  const game = await env.DB.prepare(`SELECT id FROM games WHERE id = ?`).bind(id).first();
  if (!game) return Response.json({ error: 'Game not found.' }, { status: 404 });

  const history = await getGameAuditLog(env, id);
  return Response.json(history);
}
