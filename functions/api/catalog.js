/**
 * アニノベル 投稿作品カタログAPI  /api/catalog
 * --------------------------------------------------
 * サーバー(KV)に保存された投稿作品の一覧を返す。
 * ポータル(portal.js → getCatalog)の作品一覧で使用する。
 *
 * 配置: functions/api/catalog.js
 *
 * 必要なバインディング:
 *   WORKS または WORKS_KV  (works API と同じ KV namespace: aninovel-works)
 *   ※ [id].js と同じく両方の名前に対応する。
 *
 * エンドポイント:
 *   GET /api/catalog  …  { version:'server', works:[ <カタログエントリ> ] }
 */

const CATALOG_KEY = '__catalog__';

// バインディング名を両対応 (WORKS 優先、なければ WORKS_KV) — [id].js と一致
function getKV(env) {
  return env.WORKS || env.WORKS_KV || null;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// GET /api/catalog — 投稿作品の一覧
export async function onRequestGet(context) {
  const kv = getKV(context.env);
  if (!kv) {
    return json({ version: 'server', works: [], error: 'KV (WORKS / WORKS_KV) 未バインド' });
  }
  let catalog = [];
  try {
    const cur = await kv.get(CATALOG_KEY);
    if (cur) catalog = JSON.parse(cur);
    if (!Array.isArray(catalog)) catalog = [];
  } catch (e) {
    catalog = [];
  }
  return json({ version: 'server', works: catalog });
}
