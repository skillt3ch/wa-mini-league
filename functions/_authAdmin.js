// Shared helpers for the admin endpoints — checks the X-Admin-Password
// header against either the ADMIN_PASSWORD or SUPER_ADMIN_PASSWORD secret
// (set via `wrangler pages secret put ADMIN_PASSWORD` /
// `SUPER_ADMIN_PASSWORD`). Both passwords grant full admin access; the
// super-admin one additionally unlocks visibility of IP addresses
// (see isSuperAdmin below) across the audit trail and issue reports.
// SUPER_ADMIN_PASSWORD is optional — if unset, isSuperAdmin() is always
// false and only ADMIN_PASSWORD works to log in at all.
export function isAdmin(request, env) {
  const provided = request.headers.get('x-admin-password') || '';
  if (!provided) return false;
  if (env.ADMIN_PASSWORD && provided === env.ADMIN_PASSWORD) return true;
  if (env.SUPER_ADMIN_PASSWORD && provided === env.SUPER_ADMIN_PASSWORD) return true;
  return false;
}

export function isSuperAdmin(request, env) {
  const provided = request.headers.get('x-admin-password') || '';
  return !!env.SUPER_ADMIN_PASSWORD && provided === env.SUPER_ADMIN_PASSWORD;
}

export function unauthorized() {
  return Response.json({ error: 'Invalid admin password.' }, { status: 401 });
}
