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

import { sameSite, denyHotlink } from '../_origin.js';
import { db } from '../_d1.js';

/* 2026-11-18: 閲覧数(views)を各作品に添える。ランキングで投票数が同じときの順に使う。
 *
 * 数え方: D1 の reads 表の行数。reads は「同じ読者の同じ作品は1日1行」なので、
 *         延べ閲覧数(読者×日)になる。同じ人が1日に何度開いても1と数える。
 *         ボットと、開く手順を踏まずに記録だけ投げたものは reads に入らない
 *         (api/reading.js 参照)ので、水増しにも強い。
 *
 * 負荷: カタログはトップページを開くたびに読まれる。毎回 reads を数えると
 *       D1 の読み取り枠(無料は1日500万行)を表の大きさぶん消費するので、
 *       集計結果を Cache API に10分置く。D1 が無い・失敗したときは
 *       閲覧数を付けずに返す(作品一覧は今までどおり出る)。 */
const VIEWS_TTL = 600;   // 秒

async function viewCounts(context) {
  const d = db(context.env);
  if (!d) return null;
  const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
  const key = new Request(new URL('/__cache/catalog-views', context.request.url).toString());
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return await hit.json();
    } catch (e) {}
  }
  const counts = {};
  try {
    const r = await d.prepare('SELECT work_id, COUNT(*) AS n FROM reads GROUP BY work_id').all();
    (r.results || []).forEach(function (x) { counts[x.work_id] = Number(x.n) || 0; });
  } catch (e) {
    console.warn('[catalog] 閲覧数の集計に失敗:', e && e.message);
    return null;
  }
  if (cache) {
    const res = new Response(JSON.stringify(counts), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + VIEWS_TTL },
    });
    const p = cache.put(key, res).catch(function () {});
    if (context.waitUntil) context.waitUntil(p); else await p;
  }
  return counts;
}

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
  // 作品の一覧は、海賊版サイトが中身を集めるときの目次になる。
  // 他所のページからの読み込みは断る。
  if (!sameSite(context.request)) return denyHotlink('作品の一覧');
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
  let views = null;
  try { views = await viewCounts(context); } catch (e) { views = null; }
  if (views) {
    catalog = catalog.map(function (w) {
      return (w && w.id) ? Object.assign({}, w, { views: views[w.id] || 0 }) : w;
    });
  }
  return json({ version: 'server', works: catalog });
}
