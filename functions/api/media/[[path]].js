/**
 * アニノベル 本文メディア(挿絵/動画)API  /api/media/{workId}/{mediaId}
 * ============================================================
 * 本文の途中に挟む画像と動画を R2 (AUDIO_R2, 音声・表紙と共有) に置く。
 *   PUT  /api/media/{workId}/{mediaId}        … 入れる（作者かオーナーだけ）
 *   GET  /api/media/{workId}/{mediaId}        … 返す（画像は幅を絞って軽くする）
 *   GET  /api/media/{workId}/{mediaId}?raw=1  … 元のまま返す（変換の元に使う）
 * 保存キー: media/{workId}/{mediaId}
 *
 * 2026-10-02 に直したこと
 *
 * 1) PUT に認証が無かった
 *    作品IDと項目IDが分かれば、誰でも他人の作品の挿絵を差し替えられた。
 *    どちらも本文データに入っていて、作品を開けば読み取れる。推測は要らない。
 *    表紙(/api/cover)と同じく、作者かオーナーのログインを必須にする。
 *
 * 2) 画像が原寸のまま配られていた
 *    実測で PNG 3.06MB・GIF 9.64MB が、そのまま読者に落ちていた。
 *    表紙と同じく Cloudflare の画像変換を通す。
 *    ・無料枠は「月5,000回のユニーク変換」
 *    ・同じ画像＋同じ条件は、その月1回だけ数えられる
 *    ・上限を超えても課金はされず、新しい変換が断られるだけ
 *    変換が使えないときは元画像をそのまま返す。出ないよりは重くても出す。
 *
 *    ただし GIF と動画は変換に通さない。
 *    動く GIF を変換に通すと1コマの静止画になり、動きが失われる。
 *    動画はそもそも画像変換の対象外。どちらも元のまま返す。
 *
 * 3) 画像の上限が動画と同じ50MBだった
 *    挿絵に50MBは要らない。画像は10MBまでにする。動画は50MBのまま。
 *
 * 必要な設定（Cloudflare ダッシュボード）
 *   Images > Transformations で aninovel.com のゾーンを有効にする。
 *   有効にしていない間は、静かに元画像が返るだけで、壊れはしない。
 */

import { whoAmI, hasRole } from '../../_owner.js';

const ID_RE  = /^[A-Za-z][A-Za-z0-9_\-]{0,99}$/;
const MID_RE = /^[A-Za-z0-9_\-]{1,120}$/;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 挿絵
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;  // 動画

const IMAGE_TYPES = ['image/png','image/jpeg','image/jpg','image/webp','image/gif'];
const VIDEO_TYPES = ['video/mp4','video/webm','video/ogg','video/quicktime'];
const OK_TYPES = IMAGE_TYPES.concat(VIDEO_TYPES);

// 本文に差し込む挿絵は、表紙と違って横幅いっぱいに出ることがある。
// 高解像度の画面を考えて1200pxを上限にする。
const MEDIA_WIDTH = 1200;
const MEDIA_QUALITY = 82;

function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }
  });
}

/** 変換に通してよい種類か。動く GIF と動画は通さない。 */
function transformable(ct){
  return ct === 'image/png' || ct === 'image/jpeg' || ct === 'image/jpg' || ct === 'image/webp';
}

export async function onRequestPut(context){
  const bucket = context.env.AUDIO_R2;
  if(!bucket) return json({ error: 'R2 bucket "AUDIO_R2" 未バインド' }, 500);
  const parts = context.params.path || [];
  const workId = parts[0], mediaId = parts[1];
  if(!ID_RE.test(workId||''))  return json({ error: 'invalid work id' }, 400);
  if(!MID_RE.test(mediaId||'')) return json({ error: 'invalid media id' }, 400);

  // 誰でも差し替えられてはいけない。
  let who = null;
  try { who = await whoAmI(context.request, context.env); } catch(e) { who = null; }
  if(!who) return json({ error:'unauthorized', message:'挿絵の登録にはログインが必要です。' }, 401);
  if(!hasRole(who, 'author') && !hasRole(who, 'owner')){
    return json({ error:'forbidden', message:'作者かオーナーのアカウントが必要です。' }, 403);
  }
  // 自分の作品か、オーナーか。作品の持ち主は本体の ownerEmail で判断する。
  if(!hasRole(who, 'owner')){
    let owner = null;
    try {
      const kv = context.env.WORKS || context.env.WORKS_KV;
      const raw = kv ? await kv.get('work:' + workId) : null;
      owner = raw ? (JSON.parse(raw) || {}).ownerEmail : null;
    } catch(e){
      // 誰の作品か調べられなかった。分からないまま書かせない。
      return json({ error:'unavailable', message:'いま権限を確認できません。時間をおいてお試しください。' }, 503);
    }
    if(owner && String(owner).toLowerCase() !== String(who.email).toLowerCase()){
      return json({ error:'forbidden', message:'この作品の挿絵を変える権限がありません。' }, 403);
    }
  }

  const ct = (context.request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(OK_TYPES.indexOf(ct) < 0) return json({ error: 'unsupported content-type: ' + ct }, 415);

  const buf = await context.request.arrayBuffer();
  if(!buf || buf.byteLength === 0) return json({ error: 'empty body' }, 400);
  const limit = VIDEO_TYPES.indexOf(ct) >= 0 ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if(buf.byteLength > limit){
    return json({ error: 'too large',
      message: (VIDEO_TYPES.indexOf(ct)>=0 ? '動画は50MBまでです。' : '画像は10MBまでです。') }, 413);
  }

  const key = 'media/' + workId + '/' + mediaId;
  await bucket.put(key, buf, { httpMetadata: { contentType: ct } });
  return json({ ok: true, workId, mediaId, url: '/api/media/' + workId + '/' + mediaId,
                bytes: buf.byteLength });
}

/** R2 から元のものをそのまま返す */
async function serveOriginal(bucket, key, extraHeaders){
  let obj = null;
  try { obj = await bucket.get(key); }
  catch(e){ return new Response('Not Found', { status: 404 }); }
  if(!obj) return new Response('Not Found', { status: 404 });
  const headers = new Headers(extraHeaders || {});
  headers.set('Content-Type', (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(obj.body, { status: 200, headers });
}

export async function onRequestGet(context){
  const bucket = context.env.AUDIO_R2;
  // 置き場が無い＝そのメディアが無い、として 404 を返す。
  // 500 を返すと、バインディングが外れた日に本文の挿絵が全部
  // サーバーエラーとして記録される。読む側には「無い」だけでよい。
  if(!bucket) return new Response('Not Found', { status: 404 });

  const parts = context.params.path || [];
  const workId = parts[0], mediaId = parts[1];
  if(!ID_RE.test(workId||''))  return json({ error: 'invalid work id' }, 400);
  if(!MID_RE.test(mediaId||'')) return json({ error: 'invalid media id' }, 400);

  const key = 'media/' + workId + '/' + mediaId;
  const url = new URL(context.request.url);

  // 変換のために自分自身へ取りに来た分。そのまま元を返す。
  // これをしないと変換の取得がまたここに入り、無限に回る。
  const via = context.request.headers.get('via') || '';
  if(url.searchParams.get('raw') === '1' || /image-resizing/i.test(via)){
    return serveOriginal(bucket, key, { 'X-Media': 'original' });
  }

  // 何が入っているかを見てから決める。GIF と動画は変換に通さない。
  let head = null;
  try { head = await bucket.head(key); } catch(e){ head = null; }
  if(!head) return new Response('Not Found', { status: 404 });
  const ct = (head.httpMetadata && head.httpMetadata.contentType) || '';
  if(!transformable(ct)){
    return serveOriginal(bucket, key, { 'X-Media': 'original-asis' });
  }

  try {
    const rawUrl = url.origin + '/api/media/' + encodeURIComponent(workId)
                 + '/' + encodeURIComponent(mediaId) + '?raw=1';
    const res = await fetch(rawUrl, {
      cf: { image: {
        width: MEDIA_WIDTH,
        quality: MEDIA_QUALITY,
        fit: 'scale-down',   // 元より大きくはしない
        format: 'auto',      // 見ている人のブラウザに合わせて webp / avif
      } },
    });
    if(res.ok){
      const headers = new Headers();
      headers.set('Content-Type', res.headers.get('content-type') || 'image/jpeg');
      headers.set('Cache-Control', 'public, max-age=86400');
      headers.set('X-Media', 'resized');
      return new Response(res.body, { status: 200, headers });
    }
    if(res.status === 404) return new Response('Not Found', { status: 404 });
  } catch(e){
    // 変換が使えない環境。黙って元に落とす。
  }
  return serveOriginal(bucket, key, { 'X-Media': 'original-fallback' });
}
