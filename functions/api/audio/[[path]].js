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

// 作品ID。viewer 側の上書き公開が使う _OWNER_ID_RE と同じ形式を受け入れる。
//   pub_1784818723945 … 投稿作品
//   summer-adventure  … 同梱作品(スラッグ形式・ハイフンを含む)
// R2のキーは pubId + '/' + itemId なので、'/' を含まないことだけが要件。
import { requireWrite } from '../../_auth.js';

const ID_RE = /^(?:pub_[A-Za-z0-9_]{1,80}|[A-Za-z][A-Za-z0-9_-]{0,99})$/;
const ITEM_RE = /^[A-Za-z0-9_\-]{1,120}$/;

// 1リクエストあたりの一括アップロード上限 (クライアントは25件ずつ送る)
const MAX_BUNDLE = 30 * 1024 * 1024;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// 自サイトからの再生か確認する (ホットリンク防止)
// --------------------------------------------------
// 海賊サイトが自分のページから当サイトの音声URLを直接読み込むと、
// ブラウザは Referer に相手のドメインを載せて送ってくる。そこで弾く。
// 相手が自前で再ホストするなら 2GB の保管と転送を自分で負担することになり、
// 丸ごと複製する旨みが薄れる。
//
// Referer が「無い」場合は通す。プライバシー設定で送らない読者が実在するため、
// ここで拒否すると正規の読者が音を聞けなくなる。
// つまり Referer を消せる相手は素通りできる。完全な封鎖ではなく、
// 「他所のページに貼るだけ」を止めるための措置。
const ALLOWED_REFERER = [
  'aninovel.com',
  'www.aninovel.com',
  'aninovel.pages.dev',
  'localhost',
  '127.0.0.1',
];

function refererAllowed(request) {
  const ref = request.headers.get('Referer') || request.headers.get('Origin') || '';
  if (!ref) return true;                       // 送ってこない読者は通す
  let host;
  try { host = new URL(ref).hostname.toLowerCase(); } catch (e) { return true; }
  return ALLOWED_REFERER.some(function (a) { return host === a || host.endsWith('.' + a); });
}

// GET — マニフェスト / 音声ファイル
export async function onRequestGet(context) {
  if (!refererAllowed(context.request)) {
    return json({
      error: 'hotlink_denied',
      message: 'この音声は aninovel.com でのみ再生できます。'
    }, 403);
  }
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
      // customMetadata を含めて一覧する。ここにハッシュ(本文+話者)が入っている。
      // これが無いと「既にサーバにある」としか判定できず、
      // 中身を作り直しても itemId が同じなら送られない(実際に2度この事故が起きた)。
      const listed = await bucket.list({
        prefix: pubId + '/', cursor: cursor, limit: 1000,
        include: ['customMetadata'],
      });
      for (const obj of listed.objects) {
        const itemId = obj.key.slice(pubId.length + 1);
        if (!itemId) continue;
        const h = obj.customMetadata && obj.customMetadata.hash;
        items[itemId] = h ? { hash: h } : {};
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
  const denied = requireWrite(context);      // 音声の上書きも作者・オーナーのみ
  if (denied) return denied;
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

  // 送信側は "h:<itemId>" という名前でハッシュを一緒に送る。
  // 音声そのものと同じ束に入れておけば、1往復で済む。
  const hashes = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string' && k.indexOf('h:') === 0) hashes[k.slice(2)] = v.slice(0, 64);
  }

  let saved = 0;
  const errors = [];
  for (const [itemId, file] of form.entries()) {
    // ハッシュの項目は ITEM_RE に合わないので、ID検証より先に飛ばす。
    // 順序を逆にすると「不正なID」として弾かれ、ハッシュが記録されない。
    if (itemId.indexOf('h:') === 0) continue;
    if (!ITEM_RE.test(itemId)) { errors.push(itemId + ': 不正なID'); continue; }
    if (typeof file === 'string' || !file.arrayBuffer) { errors.push(itemId + ': ファイルではありません'); continue; }
    try {
      const buf = await file.arrayBuffer();
      const put = {
        httpMetadata: { contentType: file.type || 'audio/wav' },
      };
      if (hashes[itemId]) put.customMetadata = { hash: hashes[itemId] };
      await bucket.put(pubId + '/' + itemId, buf, put);
      saved++;
    } catch (e) {
      errors.push(itemId + ': ' + e.message);
    }
  }

  return json({ ok: true, saved: saved, errors: errors });
}
