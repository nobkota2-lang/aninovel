/**
 * 作者が自分のポイントを見る  functions/api/points.js
 * ============================================================
 *
 * なぜ /api/author/ ではなく /api/points なのか
 *   api/admin/* と api/author/* は Cloudflare Access で守られていて、
 *   そこへ来た人はまず Access のログイン画面に飛ばされる。
 *   これは運営者の入口としては正しいが、一般の作者は Access の
 *   利用者ではないので、自分のポイントを見ることができなくなる。
 *   だから Access の対象外のパスに置き、サイト自身のログインで判定する。
 *
 * 見せる範囲
 *   自分が owner_email になっている作品だけ。他の作者の数字は返さない。
 *   オーナーも、この口では自分の分しか見えない（全体は /api/admin/points）。
 *
 * 使い方
 *   GET /api/points              … 直近12期間の自分のポイント
 *   GET /api/points?period=2026-10 … その期間だけ
 */

import { requireWriter, json } from '../_owner.js';
import { db, jstMonth } from '../_d1.js';

export async function onRequestGet(context) {
  const g = await requireWriter(context); if (g.deny) return g.deny;
  const me = String(g.who.email || '').toLowerCase();

  const d = db(context.env);
  if (!d) {
    // D1 がまだ無い間は「0件」ではなく「まだ数えていない」と返す。
    // 0件と出すと、読まれていないのだと誤解させてしまう。
    return json({ unavailable: true, email: me, periods: [],
                  message: 'ポイントの集計はまだ始まっていません。' });
  }

  const url = new URL(context.request.url);
  const period = url.searchParams.get('period');

  try {
    const sql = period
      ? `SELECT p.period, p.work_id, w.title, p.points, p.reads_count, p.confirmed, p.computed_at
           FROM points p LEFT JOIN works_meta w ON w.work_id = p.work_id
          WHERE p.author_email = ?1 AND p.period = ?2
          ORDER BY p.points DESC`
      : `SELECT p.period, p.work_id, w.title, p.points, p.reads_count, p.confirmed, p.computed_at
           FROM points p LEFT JOIN works_meta w ON w.work_id = p.work_id
          WHERE p.author_email = ?1
            AND p.period >= ?2
          ORDER BY p.period DESC, p.points DESC`;

    // 直近12か月ぶん
    const from = (() => {
      const [y, m] = jstMonth().split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1 - 11, 1));
      return t.toISOString().slice(0, 7);
    })();

    const rows = await d.prepare(sql).bind(me, period || from).all();
    const list = (rows && rows.results) || [];

    // 期間ごとにまとめる
    const byPeriod = {};
    for (const r of list) {
      const p = byPeriod[r.period] || (byPeriod[r.period] = { period: r.period, points: 0, reads: 0, confirmed: true, works: [] });
      p.points += Number(r.points) || 0;
      p.reads  += Number(r.reads_count) || 0;
      if (r.confirmed !== 1) p.confirmed = false;
      p.works.push({ workId: r.work_id, title: r.title, points: r.points, reads: r.reads_count });
    }
    const periods = Object.values(byPeriod)
      .map(p => ({ ...p, points: Math.round(p.points * 10000) / 10000 }))
      .sort((a, b) => b.period.localeCompare(a.period));

    return json({
      email: me,
      当月: jstMonth(),
      periods,
      合計ポイント: Math.round(periods.reduce((a, p) => a + p.points, 0) * 10000) / 10000,
      数え方: '1件の読書につき、読んだ割合（0〜1）×（会員1.0／立ち読み0.5）。30秒未満は数えません。同じ人が同じ作品を同じ日に何度読んでも1件です。',
    });
  } catch (e) {
    return json({ error: 'query_failed', message: String(e && e.message) }, 500);
  }
}
