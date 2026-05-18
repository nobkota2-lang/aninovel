/**
 * アニノベル 音声API  /api/audio/...
 * --------------------------------------------------
 * VOICEVOX で生成した音声をサーバー(Cloudflare R2)に保存し、
 * VOICEVOX が起動していない端末を含む全クライアントへ配信する。
 *
 * 配置: functions/api/audio/[[path]].js   (リポジトリ直下の functions/ 内)
 *
 * 必要なバインディング:
 *   R2 bucket を変数名 "AUDIO_R2" でこの Pages プロジェクトにバインドする。
 *   ダッシュボード: Pages > Settings > Functions > R2 bucket bindings
 *     Variable name: AUDIO_R2  /  R2 bucket: aninovel-audio
 *
 * エンドポイント:
 *   GET /api/audio/{pubId}            … 音声マニフェスト {workId, items:{itemId:{}}}
 *   GET /api/audio/{pubId}/{itemId}   … 音声ファイル(audio/wav)
 *   PUT /api/audio/{pubId}            … 音声の一括アップロード
 *                                       (multipart/form-data, 各フィールド名=itemId)
 *
 * 注: CORS / レート制限 は functions/_middleware.js が処理する。
 */

const ID_RE = /^pub_[A-Za-z0-9_]{1,80}$/;
const ITEM_RE = /^[A-Za-z0-9_\-]{1,120}$/;

// 1リクエストあたりの一括アップロード上限 (クライアントは25件ずつ送る)
const MAX_BUNDLE = 30 * 1024 * 1024;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// GET — マニフェスト / 音声ファイル
export async function onRequestGet(context) {
  const parts = context.params.path || [];
  const bucket = context.env.AUDIO_R2;
  if (!bucket) return json({ error: 'R2 bucket "AUDIO_R2" が未バインドです' }, 500);

  const pubId = parts[0];
  if (!pubId || !ID_RE.test(pubId)) return json({ error: 'invalid work id' }, 400);

  // GET /api/audio/{pubId} — 音声マニフェスト
  if (parts.length === 1) {
    const items = {};
    let cursor;
    do {
      const listed = await bucket.list({ prefix: pubId + '/', cursor: cursor, limit: 1000 });
      for (const obj of listed.objects) {
        const itemId = obj.key.slice(pubId.length + 1);
        if (itemId) items[itemId] = {};
      }
      cursor = listed.truncated ? listed.cursor : null;
    } while (cursor);
    return json({ workId: pubId, items: items });
  }

  // GET /api/audio/{pubId}/{itemId} — 音声ファイル
  if (parts.length === 2) {
    const itemId = parts[1];
    if (!ITEM_RE.test(itemId)) return json({ error: 'invalid item id' }, 400);
    const obj = await bucket.get(pubId + '/' + itemId);
    if (!obj) return json({ error: 'not found' }, 404);
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'audio/wav',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  return json({ error: 'bad path' }, 400);
}

// PUT /api/audio/{pubId} — 音声を一括アップロード
export async function onRequestPut(context) {
  const parts = context.params.path || [];
  const bucket = context.env.AUDIO_R2;
  if (!bucket) return json({ error: 'R2 bucket "AUDIO_R2" が未バインドです' }, 500);

  const pubId = parts[0];
  if (!pubId || !ID_RE.test(pubId) || parts.length !== 1) {
    return json({ error: 'PUT は /api/audio/{pubId} 宛に multipart/form-data で送信してください' }, 400);
  }

  const cl = Number(context.request.headers.get('content-length') || 0);
  if (cl > MAX_BUNDLE) {
    return json({ error: '音声データが大きすぎます (1回あたり上限30MB)' }, 413);
  }

  let form;
  try {
    form = await context.request.formData();
  } catch (e) {
    return json({ error: 'multipart/form-data として読み取れませんでした' }, 400);
  }

  let saved = 0;
  const errors = [];
  for (const [itemId, file] of form.entries()) {
    if (!ITEM_RE.test(itemId)) { errors.push(itemId + ': 不正なID'); continue; }
    if (typeof file === 'string' || !file.arrayBuffer) { errors.push(itemId + ': ファイルではありません'); continue; }
    try {
      const buf = await file.arrayBuffer();
      await bucket.put(pubId + '/' + itemId, buf, {
        httpMetadata: { contentType: file.type || 'audio/wav' },
      });
      saved++;
    } catch (e) {
      errors.push(itemId + ': ' + e.message);
    }
  }

  return json({ ok: true, saved: saved, errors: errors });
}
