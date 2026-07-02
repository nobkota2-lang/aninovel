/**
 * アニノベル 表紙画像API  /api/cover/{workId}
 * 表紙画像を R2 (AUDIO_R2, 音声と共有) に保存/取得する。
 *   PUT  /api/cover/{workId}   … 表紙画像アップロード (body=画像バイナリ, Content-Typeで判定)
 *   GET  /api/cover/{workId}   … 表紙画像を返す
 * 保存キー: cover/{workId}
 */
const ID_RE = /^[A-Za-z][A-Za-z0-9_\-]{0,99}$/;
const MAX_BYTES = 5 * 1024 * 1024; // 表紙は5MBまで
const OK_TYPES = ['image/png','image/jpeg','image/jpg','image/webp','image/gif'];

function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }
  });
}

export async function onRequestPut(context){
  const bucket = context.env.AUDIO_R2;
  if(!bucket) return json({ error: 'R2 bucket "AUDIO_R2" が未バインド' }, 500);
  const workId = (context.params.workId || '').toString();
  if(!ID_RE.test(workId)) return json({ error: 'invalid work id' }, 400);

  const ct = (context.request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if(OK_TYPES.indexOf(ct) < 0) return json({ error: 'unsupported content-type: ' + ct }, 415);

  const buf = await context.request.arrayBuffer();
  if(!buf || buf.byteLength === 0) return json({ error: 'empty body' }, 400);
  if(buf.byteLength > MAX_BYTES) return json({ error: 'too large (max 5MB)' }, 413);

  const key = 'cover/' + workId;
  await bucket.put(key, buf, { httpMetadata: { contentType: ct } });
  return json({ ok: true, workId: workId, url: '/api/cover/' + workId });
}

export async function onRequestGet(context){
  const bucket = context.env.AUDIO_R2;
  if(!bucket) return json({ error: 'R2 bucket "AUDIO_R2" が未バインド' }, 500);
  const workId = (context.params.workId || '').toString();
  if(!ID_RE.test(workId)) return json({ error: 'invalid work id' }, 400);

  const obj = await bucket.get('cover/' + workId);
  if(!obj) return new Response('Not Found', { status: 404 });
  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(obj.body, { status: 200, headers });
}