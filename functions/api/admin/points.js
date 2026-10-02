/**
 * ポイントの集計（オーナー専用）  functions/api/admin/points.js
 * ============================================================
 *
 * 何をするか
 *   読書ログ(reads)を月ごとに集計して、ポイント台帳(points)に書く。
 *
 * ポイントの決め方（2026-10-02 Nobbyが決定）
 *   1件の読書ログ = 同じ読者が同じ作品を同じ日に読んだ記録（1日1行）。
 *   その1件あたりの点数は
 *       読んだ割合（0.0〜1.0） × 会員なら 1.0 ／ 立ち読みなら 0.5
 *   ただし滞在が30秒未満のものは 0 点とする（開いて閉じただけを除く）。
 *
 *   「読んだ割合をそのまま」にしたのは、長編と短編のどちらにも
 *   公平で、作者に説明しやすいため。立ち読みを半分に見るのは、
 *   キャンペーン中の収益が広告である以上、立ち読みも収益を生んで
 *   いるが、会員と同じ重みにはしない、という判断。
 *
 * 締め
 *   confirmed=1 にした期間は、以後いくら再集計しても動かない。
 *   支払いの根拠にするので、後から数字が変わってはいけない。
 *
 * 使い方
 *   POST /api/admin/points {"period":"2026-10"}              … 集計する
 *   POST /api/admin/points {"period":"2026-10","dryRun":true} … 計算して見せるだけ
 *   POST /api/admin/points {"backfill":true}                  … 既存作品を works_meta に取り込む
 *   POST /api/admin/points {"period":"2026-10","confirm":true}… 締める（以後動かない）
 *   GET  /api/admin/points?period=2026-10                     … 結果を見る
 */

import { requireOwner, json } from '../../_owner.js';
import { db, jstMonth } from '../../_d1.js';

// 1件あたりの点数。会員は満点、立ち読みは半分。30秒未満は数えない。
const SCORE = `CASE WHEN r.seconds < 30 THEN 0
                    ELSE r.progress * (CASE WHEN r.member = 1 THEN 1.0 ELSE 0.5 END) END`;

const AGGREGATE = `
INSERT INTO points (period, author_email, work_id, points, reads_count, confirmed, computed_at)
SELECT ?1,
       w.owner_email,
       r.work_id,
       ROUND(SUM(${SCORE}), 4),
       SUM(CASE WHEN r.seconds < 30 THEN 0 ELSE 1 END),
       0, ?2
  FROM reads r
  JOIN works_meta w ON w.work_id = r.work_id
 WHERE substr(r.day, 1, 7) = ?1
   AND w.owner_email IS NOT NULL
 GROUP BY w.owner_email, r.work_id
ON CONFLICT(period, author_email, work_id) DO UPDATE SET
   points      = excluded.points,
   reads_count = excluded.reads_count,
   computed_at = excluded.computed_at
 WHERE points.confirmed = 0`;

const PREVIEW = `
SELECT w.owner_email AS author_email, r.work_id, w.title,
       ROUND(SUM(${SCORE}), 4) AS points,
       SUM(CASE WHEN r.seconds < 30 THEN 0 ELSE 1 END) AS reads_count,
       COUNT(*) AS rows_all
  FROM reads r
  JOIN works_meta w ON w.work_id = r.work_id
 WHERE substr(r.day, 1, 7) = ?1
   AND w.owner_email IS NOT NULL
 GROUP BY w.owner_email, r.work_id
 ORDER BY points DESC`;

function noDb() {
  return json({ error: 'no_d1',
    message: 'D1 が繋がっていません。Pages の Settings → Bindings で、変数名 DB として追加してください。' }, 503);
}

/** 既存の公開作品を works_meta に取り込む。
 *  D1 を入れる前に公開した作品は works_meta に無く、そのままでは
 *  読まれてもポイントが誰のものか分からない。最初に1度だけ走らせる。 */
async function backfill(env, d) {
  const kv = env.WORKS || env.WORKS_KV;
  if (!kv) return json({ error: 'no_kv' }, 500);

  let catalog;
  try {
    const raw = await kv.get('__catalog__');
    catalog = raw ? JSON.parse(raw) : null;
  } catch (e) {
    return json({ error: 'catalog_unreadable', message: String(e && e.message) }, 500);
  }
  const works = (catalog && catalog.works) || [];
  const now = new Date().toISOString();

  const done = [], skipped = [];
  for (const w of works) {
    if (!w || !w.id) continue;
    let owner = null, created = null;
    try {
      const raw = await kv.get('work:' + w.id);
      const body = raw ? JSON.parse(raw) : null;
      owner = body && body.ownerEmail ? String(body.ownerEmail).toLowerCase() : null;
      created = (body && body.createdAt) || null;
    } catch (e) { /* 読めなければ持ち主なしとして記録する */ }

    try {
      await d.prepare(
        `INSERT INTO works_meta (work_id, owner_email, title, status, created_at, published_at, last_edited_at)
         VALUES (?1, ?2, ?3, 'published', ?4, ?4, ?5)
         ON CONFLICT(work_id) DO UPDATE SET
           owner_email = COALESCE(?2, owner_email),
           title       = COALESCE(?3, title),
           status      = COALESCE('published', status)`
      ).bind(w.id, owner, w.title || null, created || now, now).run();
      (owner ? done : skipped).push({ id: w.id, title: w.title, owner });
    } catch (e) {
      skipped.push({ id: w.id, title: w.title, error: String(e && e.message) });
    }
  }
  return json({
    ok: true, 取り込んだ作品: done.length, 持ち主が分からない作品: skipped.length,
    注意: skipped.length ? '持ち主の分からない作品はポイントが付きません。admin-authors から ownerEmail を入れてください。' : null,
    done, skipped,
  });
}

export async function onRequestGet(context) {
  const g = await requireOwner(context); if (g.deny) return g.deny;
  const d = db(context.env); if (!d) return noDb();
  const url = new URL(context.request.url);
  const period = url.searchParams.get('period') || jstMonth();
  try {
    const rows = await d.prepare(
      `SELECT p.period, p.author_email, p.work_id, w.title, p.points, p.reads_count,
              p.confirmed, p.computed_at
         FROM points p LEFT JOIN works_meta w ON w.work_id = p.work_id
        WHERE p.period = ?1
        ORDER BY p.points DESC`).bind(period).all();
    const list = (rows && rows.results) || [];
    const total = list.reduce((a, r) => a + (Number(r.points) || 0), 0);
    return json({ period, 合計ポイント: Math.round(total * 10000) / 10000,
                  作品数: list.length, 締め済み: list.length > 0 && list.every(r => r.confirmed === 1),
                  rows: list });
  } catch (e) {
    return json({ error: 'query_failed', message: String(e && e.message) }, 500);
  }
}

export async function onRequestPost(context) {
  const g = await requireOwner(context); if (g.deny) return g.deny;
  const d = db(context.env); if (!d) return noDb();

  let body = {};
  try { body = await context.request.json(); } catch (e) {}

  if (body.backfill) return backfill(context.env, d);

  const period = String(body.period || jstMonth()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return json({ error: 'bad_period', message: '期間は YYYY-MM の形で指定してください。' }, 400);
  }
  const now = new Date().toISOString();

  // 締める
  if (body.confirm) {
    try {
      const r = await d.prepare(
        'UPDATE points SET confirmed = 1 WHERE period = ?1 AND confirmed = 0').bind(period).run();
      return json({ ok: true, period, 締めた行数: (r && r.meta && r.meta.changes) || 0,
                    注意: 'この期間は以後、再集計しても数字が変わりません。' });
    } catch (e) {
      return json({ error: 'confirm_failed', message: String(e && e.message) }, 500);
    }
  }

  // 計算して見せるだけ
  if (body.dryRun) {
    try {
      const rows = await d.prepare(PREVIEW).bind(period).all();
      const list = (rows && rows.results) || [];
      const total = list.reduce((a, r) => a + (Number(r.points) || 0), 0);
      return json({ dryRun: true, period, 合計ポイント: Math.round(total * 10000) / 10000,
                    作品数: list.length, rows: list });
    } catch (e) {
      return json({ error: 'preview_failed', message: String(e && e.message) }, 500);
    }
  }

  // 書き込む
  try {
    await d.prepare(AGGREGATE).bind(period, now).run();
    const rows = await d.prepare(
      `SELECT p.author_email, p.work_id, w.title, p.points, p.reads_count, p.confirmed
         FROM points p LEFT JOIN works_meta w ON w.work_id = p.work_id
        WHERE p.period = ?1 ORDER BY p.points DESC`).bind(period).all();
    const list = (rows && rows.results) || [];
    const total = list.reduce((a, r) => a + (Number(r.points) || 0), 0);
    return json({ ok: true, period, computed_at: now,
                  合計ポイント: Math.round(total * 10000) / 10000,
                  作品数: list.length, rows: list });
  } catch (e) {
    return json({ error: 'aggregate_failed', message: String(e && e.message) }, 500);
  }
}
