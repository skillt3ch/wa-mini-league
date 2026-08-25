import { isAdmin, isSuperAdmin, unauthorized } from '../../../../_authAdmin.js';
import { getGameAuditLog } from '../../../../_gameAudit.js';

// GET /api/admin/games/:id/history — full audit trail for one game
// (submission, admin edits, WADB rechecks), oldest first. Open to any
// admin, but the IP address behind each entry — the original submitter's,
// same as an admin's edit or recheck — is only included for super admins.
// Regular admins get null for every entry's adminIp, indistinguishable
// from each other, so there's no indication IP logging exists at all, not
// just a withheld value.
export async function onRequestGet(context) {
  const { env, request, params } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const canSeeIp = isSuperAdmin(request, env);

  const id = Number(params.id);
  const game = await env.DB.prepare(`SELECT id FROM games WHERE id = ?`).bind(id).first();
  if (!game) return Response.json({ error: 'Game not found.' }, { status: 404 });

  const history = await getGameAuditLog(env, id);
  const out = canSeeIp ? history : history.map(entry => ({ ...entry, adminIp: null }));

  return Response.json(out);
}
