/**
 * アニノベル 投稿作品カタログAPI  /api/catalog
 * --------------------------------------------------
 * サーバー(KV)に保存された投稿作品の一覧を返す。
 * ポータル(portal.js → getCatalog)の作品一覧で使用する。
 *
 * 配置: functions/api/catalog.js   (リポジトリ直下の functions/ 内)
 *
 * 必要なバインディング:
 *   WORKS_KV  (works API と同じ KV namespace: aninovel-works)
 *
 * エンドポイント:
 *   GET /api/catalog  …  { version:'server', works:[ <カタログエントリ> ] }
 *
 * 注: CORS / レート制限 は functions/_middleware.js が処理する。
 */

const CATALOG_KEY = '__catalog__';

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
  if (!context.env.WORKS_KV) {
    // KV未バインドでもポータルが壊れないよう空配列を返す
    return json({ version: 'server', works: [], error: 'WORKS_KV 未バインド' });
  }
  let catalog = [];
  try {
    const cur = await context.env.WORKS_KV.get(CATALOG_KEY);
    if (cur) catalog = JSON.parse(cur);
    if (!Array.isArray(catalog)) catalog = [];
  } catch (e) {
    catalog = [];
  }
  return json({ version: 'server', works: catalog });
}
