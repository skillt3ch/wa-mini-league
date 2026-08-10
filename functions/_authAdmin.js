// Shared helper for the admin endpoints — checks the X-Admin-Password
// header against the ADMIN_PASSWORD secret (set via `wrangler pages
// secret put ADMIN_PASSWORD`). One shared password for edit + delete,
// intentionally simple for a small honour-system league.
export function isAdmin(request, env) {
  const provided = request.headers.get('x-admin-password') || '';
  return !!env.ADMIN_PASSWORD && provided === env.ADMIN_PASSWORD;
}

export function unauthorized() {
  return Response.json({ error: 'Invalid admin password.' }, { status: 401 });
}
