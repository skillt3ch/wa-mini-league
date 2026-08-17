import { isAdmin, isSuperAdmin, unauthorized } from '../../../_authAdmin.js';

// GET /api/admin/reports — list every submitted report, open ones first
// (newest first within each group). The reporter's IP is only included
// for super admins. Regular admins get the field omitted entirely (null)
// rather than a placeholder — they shouldn't see any indication that IP
// logging exists at all, not just have the value withheld.
export async function onRequestGet(context) {
  const { env, request } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const canSeeIp = isSuperAdmin(request, env);

  const reports = await env.DB.prepare(
    `SELECT id, category, message, reporter_name, ip_address, status, submitted_at
     FROM reports
     ORDER BY (status = 'open') DESC, submitted_at DESC`
  ).all();

  const out = reports.results.map(r => ({
    id: r.id,
    category: r.category,
    message: r.message,
    reporterName: r.reporter_name,
    ipAddress: canSeeIp ? r.ip_address : null,
    status: r.status,
    submittedAt: r.submitted_at
  }));

  return Response.json(out);
}
