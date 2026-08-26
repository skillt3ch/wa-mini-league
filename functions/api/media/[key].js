// GET /api/media/:key — streams public, self-hosted media assets (currently
// just the SRoper explainer video) from the MEDIA R2 bucket. Not gated by
// any password — this is promotional/reference content, not gameplay
// evidence, so it's fine for anyone to fetch directly.
//
// Cloudflare Pages caps individual static assets at 25MB, which the video
// (~200MB) is nowhere near, so it can't just live in public/ like the
// scheme/map-pack downloads — R2 has no such limit. Range requests are
// handled explicitly so the <video> player on /scheme.html can seek/scrub
// without downloading the whole file first; without this, browsers either
// refuse to seek or silently buffer the entire object before playback.
export async function onRequestGet(context) {
  const { env, params, request } = context;
  const r2Key = `media/${params.key}`;

  const rangeHeader = request.headers.get('Range');
  const obj = await env.MEDIA.get(r2Key, rangeHeader ? { range: request.headers } : undefined);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');

  // obj.range is only present when the request actually included a Range
  // header and R2 honoured it — respond 206 with the matching Content-Range
  // in that case, otherwise serve the whole object with a normal 200.
  if (rangeHeader && obj.range && 'offset' in obj.range && 'length' in obj.range) {
    const { offset, length } = obj.range;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('content-length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
