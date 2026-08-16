import { isAdmin, unauthorized } from '../../../_authAdmin.js';

// GET /api/admin/reports — list every submitted report, open ones first
// (newest first within each group).
export async function onRequestGet(context) {
  const { env, request } = context;
  if (!isAdmin(request, env)) return unauthorized();

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
    ipAddress: r.ip_address,
    status: r.status,
    submittedAt: r.submitted_at
  }));

  return Response.json(out);
}
