// POST /api/reports — submit a complaint/issue. Public, no login required
// (same honour-system philosophy as replay submission), but the reporter's
// IP is captured server-side and used for a light rate limit so this can't
// be used to spam the admin panel.
const CATEGORIES = new Set(['player', 'bug', 'other']);
const MAX_MESSAGE_LEN = 2000;
const MAX_NAME_LEN = 60;
const RATE_LIMIT_WINDOW_MIN = 60;
const RATE_LIMIT_MAX = 5;

export async function onRequestPost(context) {
  const { env, request } = context;
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const message = String(body.message || '').trim();
  const category = CATEGORIES.has(body.category) ? body.category : 'other';
  const reporterName = String(body.reporterName || '').trim().slice(0, MAX_NAME_LEN) || null;

  if (!message) return Response.json({ error: 'Please describe the issue.' }, { status: 400 });
  if (message.length > MAX_MESSAGE_LEN) {
    return Response.json({ error: `Keep it under ${MAX_MESSAGE_LEN} characters.` }, { status: 400 });
  }

  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';

  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM reports WHERE ip_address = ? AND submitted_at >= datetime('now', ?)`
  ).bind(ip, `-${RATE_LIMIT_WINDOW_MIN} minutes`).first();
  if (recent.count >= RATE_LIMIT_MAX) {
    return Response.json({ error: 'Too many reports submitted recently — please try again later.' }, { status: 429 });
  }

  await env.DB.prepare(
    `INSERT INTO reports (category, message, reporter_name, ip_address) VALUES (?, ?, ?, ?)`
  ).bind(category, message, reporterName, ip).run();

  return Response.json({ ok: true });
}
