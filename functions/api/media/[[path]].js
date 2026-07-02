/**
 * アニノベル 本文メディア(挿絵/動画)API  /api/media/{workId}/{mediaId}
 * R2 (AUDIO_R2, 音声・表紙と共有) に保存/取得。
 *   PUT  /api/media/{workId}/{mediaId}  … アップロード (body=バイナリ, Content-Typeで判定)
 *   GET  /api/media/{workId}/{mediaId}  … 取得
 * 保存キー: media/{workId}/{mediaId}
 */
const ID_RE = /^[A-Za-z][A-Za-z0-9_\-]{0,99}$/;
const MID_RE = /^[A-Za-z0-9_\-]{1,120}$/;
const MAX_BYTES = 50 * 1024 * 1024; // 動画対応で50MB
const OK_TYPES = ['image/png','image/jpeg','image/jpg','image/webp','image/gif','video/mp4','video/webm','video/ogg','video/quicktime'];

function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }
  });
}

export async function onRequestPut(context){
  const bucket = context.env.AUDIO_R2;
  if(!bucket) return json({ error: 'R2 bucket "AUDIO_R2" 未バインド' }, 500);
  const parts = context.params.path || [];
  const workId = parts[0], mediaId = parts[1];
  if(!ID_RE.test(workId||'')) return json({ error: 'invalid work id' }, 400);
  if(!MID_RE.test(mediaId||'')) return json({ error: 'invalid media id' }, 400);

  const ct = (context.request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(OK_TYPES.indexOf(ct) < 0) return json({ error: 'unsupported content-type: ' + ct }, 415);

  const buf = await context.request.arrayBuffer();
  if(!buf || buf.byteLength === 0) return json({ error: 'empty body' }, 400);
  if(buf.byteLength > MAX_BYTES) return json({ error: 'too large (max 50MB)' }, 413);

  const key = 'media/' + workId + '/' + mediaId;
  await bucket.put(key, buf, { httpMetadata: { contentType: ct } });
  return json({ ok: true, workId, mediaId, url: '/api/media/' + workId + '/' + mediaId });
}

export async function onRequestGet(context){
  const bucket = context.env.AUDIO_R2;
  if(!bucket) return json({ error: 'R2 bucket "AUDIO_R2" 未バインド' }, 500);
  const parts = context.params.path || [];
  const workId = parts[0], mediaId = parts[1];
  if(!ID_RE.test(workId||'')) return json({ error: 'invalid work id' }, 400);
  if(!MID_RE.test(mediaId||'')) return json({ error: 'invalid media id' }, 400);

  const obj = await bucket.get('media/' + workId + '/' + mediaId);
  if(!obj) return new Response('Not Found', { status: 404 });
  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(obj.body, { status: 200, headers });
}