// POST /api/analyze — best-effort, read-only preview. Called immediately
// client-side as soon as a replay is dropped/selected (public/index.html),
// *before* the submitter does anything else — not deferred to Confirm &
// submit. Forwards the file to WADB and hands back its engine-resolved
// team/player data so the "Players in this replay" list can be pre-filled
// from that instead of the local .WAgame parser's byte-signature guess,
// which has a proven track record of getting spectators/non-owning
// machines wrong (see the long comment in public/js/parser.js).
//
// Deliberately does nothing else: no DB reads/writes, no player/alias
// creation, no game record. Purely a UX convenience so the submitter sees
// the right names sooner. POST /api/submit still independently calls WADB
// itself at actual submission time (functions/_wadb.js's
// applyWadbIdentityCorrections) — nothing here is trusted server-side for
// the real winner/identity resolution, so there's no security concern in
// a client just... not calling this, or a slow/flaky network meaning it
// never resolves before the submitter hits Confirm & submit anyway.
import { callWadb } from '../_wadb.js';

export async function onRequestPost(context) {
  const { request } = context;

  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, reason: 'Expected multipart/form-data.' });
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return Response.json({ ok: false, reason: 'Missing replay file.' });
  }

  const bytes = await file.arrayBuffer();
  const result = await callWadb(bytes, file.name);
  if (!result.ok) {
    return Response.json({ ok: false, reason: result.reason });
  }

  return Response.json({ ok: true, game: result.game });
}
