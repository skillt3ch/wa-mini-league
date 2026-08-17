import { unauthorized } from '../../_authAdmin.js';

// POST /api/admin/verify — used by the admin page to check a password
// before showing the panel. Body: { password }
// Accepts either ADMIN_PASSWORD or SUPER_ADMIN_PASSWORD; the response
// tells the frontend which tier logged in so it knows whether to expect
// IP addresses in later responses (they're redacted server-side either
// way — this flag is just so the UI can show an indicator, not something
// the frontend enforces itself).
export async function onRequestPost(context) {
  const { env, request } = context;
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const isSuper = !!env.SUPER_ADMIN_PASSWORD && body.password === env.SUPER_ADMIN_PASSWORD;
  const isRegular = !!env.ADMIN_PASSWORD && body.password === env.ADMIN_PASSWORD;
  if (!isSuper && !isRegular) return unauthorized();

  return Response.json({ ok: true, isSuperAdmin: isSuper });
}
