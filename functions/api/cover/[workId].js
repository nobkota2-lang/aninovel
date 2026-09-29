/**
 * アニノベル 表紙画像API  /api/cover/{workId}
 * ============================================================
 * 表紙画像を R2 (AUDIO_R2, 音声と共有) に保存/取得する。
 *   PUT  /api/cover/{workId}        … 表紙をアップロード（作者かオーナーだけ）
 *   GET  /api/cover/{workId}        … 表紙を返す（幅を絞って軽くする）
 *   GET  /api/cover/{workId}?raw=1  … 元のままの表紙を返す（変換の元として使う）
 * 保存キー: cover/{workId}
 *
 * なぜ縮小するのか（2026-09-29 追加）
 *   元の表紙は1枚3〜3.6MB あった。一覧に14枚並ぶので、トップページを
 *   一度開くだけで約50MB。スマホの通信量を食い、表示も数秒待たされ、
 *   R2 の転送量も読者数に比例して積み上がる。
 *   本来この用途なら 100〜200KB で足りる。
 *
 * どう縮小するか
 *   Cloudflare の画像変換を fetch の cf.image で通す。
 *   ・無料枠は「月5,000回のユニーク変換」。作品15本なら月30回ほどで収まる
 *   ・同じ画像＋同じ条件の組み合わせは、その月1回だけ数えられる
 *   ・上限を超えても課金はされず、新しい変換が断られるだけ
 *
 *   変換が使えない場合（ゾーンで未有効、上限超過、その他の失敗）は、
 *   元の画像をそのまま返す。表紙が出ないより、重くても出るほうがよい。
 *
 * 必要な設定（Cloudflare ダッシュボード）
 *   Images > Transformations で aninovel.com のゾーンを有効にする。
 *   有効にしていない間は、静かに元画像が返るだけで、壊れはしない。
 */

import { whoAmI, hasRole } from '../../_owner.js';

const ID_RE = /^[A-Za-z][A-Za-z0-9_\-]{0,99}$/;
const MAX_BYTES = 5 * 1024 * 1024; // 表紙は5MBまで
const OK_TYPES = ['image/png','image/jpeg','image/jpg','image/webp','image/gif'];

// 一覧のカードは実寸で250px前後。高解像度の画面を考えて2倍の600pxを上限にする。
const COVER_WIDTH = 600;
const COVER_QUALITY = 80;

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

  // 誰でも表紙を差し替えられてはいけない。
  // ここには認証が無く、作品IDさえ分かれば他人の表紙を上書きできた。
  let who = null;
  try { who = await whoAmI(context.request, context.env); } catch(e) { who = null; }
  if(!who) return json({ error:'unauthorized', message:'表紙の登録にはログインが必要です。' }, 401);
  if(!hasRole(who, 'author') && !hasRole(who, 'owner')){
    return json({ error:'forbidden', message:'作者かオーナーのアカウントが必要です。' }, 403);
  }
  // 自分の作品か、オーナーか。作品の作者は本体の ownerEmail で判断する。
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
      return json({ error:'forbidden', message:'この作品の表紙を変える権限がありません。' }, 403);
    }
  }

  const ct = (context.request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if(OK_TYPES.indexOf(ct) < 0) return json({ error: 'unsupported content-type: ' + ct }, 415);

  const buf = await context.request.arrayBuffer();
  if(!buf || buf.byteLength === 0) return json({ error: 'empty body' }, 400);
  if(buf.byteLength > MAX_BYTES) return json({ error: 'too large (max 5MB)' }, 413);

  const key = 'cover/' + workId;
  await bucket.put(key, buf, { httpMetadata: { contentType: ct } });
  return json({ ok: true, workId: workId, url: '/api/cover/' + workId,
                bytes: buf.byteLength });
}

/** R2 から元の画像をそのまま返す */
async function serveOriginal(bucket, workId, extraHeaders){
  let obj = null;
  try { obj = await bucket.get('cover/' + workId); }
  catch(e){ return new Response('Not Found', { status: 404 }); }
  if(!obj) return new Response('Not Found', { status: 404 });
  const headers = new Headers(extraHeaders || {});
  headers.set('Content-Type', (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/png');
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(obj.body, { status: 200, headers });
}

export async function onRequestGet(context){
  const bucket = context.env.AUDIO_R2;
  // 置き場が無い＝表紙が無い、として 404 を返す。
  // 以前は 500 を返していたため、バインディングが外れた日に
  // 作品一覧のすべての表紙がサーバーエラーとして記録された。
  // 読む側にとっては「表紙が無い」だけなので、404 のほうが正しい。
  if(!bucket) return new Response('No cover storage', { status: 404 });

  const workId = (context.params.workId || '').toString();
  if(!ID_RE.test(workId)) return json({ error: 'invalid work id' }, 400);

  const url = new URL(context.request.url);

  // 変換をかけた画像を取りに来た自分自身からの再訪。そのまま元画像を返す。
  // これをしないと、変換のための取得がまたこの関数に入り、無限に回る。
  const via = context.request.headers.get('via') || '';
  if(url.searchParams.get('raw') === '1' || /image-resizing/i.test(via)){
    return serveOriginal(bucket, workId, { 'X-Cover': 'original' });
  }

  // 変換して返す。元画像は ?raw=1 の口から取ってもらう。
  try {
    const rawUrl = url.origin + '/api/cover/' + encodeURIComponent(workId) + '?raw=1';
    const res = await fetch(rawUrl, {
      cf: { image: {
        width: COVER_WIDTH,
        quality: COVER_QUALITY,
        fit: 'scale-down',     // 元より大きくはしない
        format: 'auto',        // 見ている人のブラウザに合わせて webp / avif
      } },
    });
    if(res.ok){
      const headers = new Headers();
      headers.set('Content-Type', res.headers.get('content-type') || 'image/jpeg');
      headers.set('Cache-Control', 'public, max-age=86400');
      headers.set('X-Cover', 'resized');
      return new Response(res.body, { status: 200, headers });
    }
    // 変換が断られた（ゾーン未有効・月の上限超過など）。元画像で通す。
    if(res.status === 404) return new Response('Not Found', { status: 404 });
  } catch(e){
    // 変換そのものが使えない環境。黙って元画像に落とす。
  }
  return serveOriginal(bucket, workId, { 'X-Cover': 'original-fallback' });
}
