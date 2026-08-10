import { unauthorized } from '../../_authAdmin.js';

// POST /api/admin/verify — used by the admin page to check a password
// before showing the panel. Body: { password }
export async function onRequestPost(context) {
  const { env, request } = context;
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const ok = !!env.ADMIN_PASSWORD && body.password === env.ADMIN_PASSWORD;
  if (!ok) return unauthorized();
  return Response.json({ ok: true });
}
