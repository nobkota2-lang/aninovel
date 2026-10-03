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
 * ポイントと金額は別物（2026-10-03 決定）
 *   1ポイント＝1円ではない。1ポイントがいくらになるかは期間ごとに変わる。
 *
 *     分配できる額  ＝ その期間の収益 × (1 − 運営者の取り分)
 *     1ポイントの額 ＝ 分配できる額 ÷ その期間に発生したポイントの総数
 *
 *   ポイントは「どれだけ読まれたか」の指標として残し、金額は期間を締める
 *   ときに確定させて points.amount_yen に持つ。二重に持つことになるが、
 *   単価が期間ごとに変わる以上、ポイントだけでは後から金額を復元できない。
 *   その期間の収益・取り分・単価は periods に残す。計算をやり直せるように。
 *
 * 締め
 *   confirmed=1 にした期間は、以後いくら再集計しても動かない。
 *   支払いの根拠にするので、後から数字が変わってはいけない。
 *
 * 使い方
 *   POST /api/admin/points {"period":"2026-10","dryRun":true}  … 計算して見せるだけ
 *   POST /api/admin/points {"period":"2026-10"}                … ポイントを集計する
 *   POST /api/admin/points {"period":"2026-10","revenue":12000,"ownerRate":0.5}
 *                                                              … 金額まで計算する
 *   POST /api/admin/points {"period":"2026-10","revenue":12000,"confirm":true}
 *                                                              … 金額を入れて締める
 *   POST /api/admin/points {"backfill":true}                   … 既存作品を works_meta に取り込む
 *   POST /api/admin/points {"backfill":true,"defaultOwner":"x@y"} … 持ち主が KV に無い作品だけ x@y のものにする
 *   POST /api/admin/points {"payout":{"email":"x@y","amountYen":2000}}
 *                                                              … 支払った記録を残す
 *   GET  /api/admin/points?period=2026-10                      … 結果を見る
 *   GET  /api/admin/points?balances=1                          … 作者ごとの未払い残高
 */

import { requireOwner, json } from '../../_owner.js';
import { db, jstMonth, SCORE_SQL } from '../../_d1.js';

// 点数の式は _d1.js にひとつだけ置く。ここで別に書くと、作者が見る
// 画面(api/points.js)との間でいつか食い違う。
const SCORE = SCORE_SQL;

// 運営者の取り分。当初は5割。収益を上げる構造になったら見直す。
// 実際に使った値は期間ごとに periods.owner_rate に残すので、
// この既定値を変えても、締め済みの期間の計算には影響しない。
const DEFAULT_OWNER_RATE = 0.5;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** 読書ログを集計して points に書く。締めた行は AGGREGATE 側で守られる。 */
async function aggregate(d, period, now) {
  await d.prepare(AGGREGATE).bind(period, now).run();
}

/**
 * その期間の収益から1ポイントあたりの金額を出し、各行に金額を入れる。
 *
 * 先に集計を走らせる。集計せずに収益だけ入れると、ポイントの合計が 0 の
 * まま 0 で割ることになり、黙って「1ポイント0円」になってしまう。
 * 順番を覚えていないと間違える作りにはしない。
 *
 * 締めていない行だけを書き換える。締めた期間の金額は動かさない。
 */
async function applyRevenue(d, period, revenue, ownerRate, now) {
  const rev = Number(revenue);
  if (!isFinite(rev) || rev < 0) {
    return { error: json({ error: 'bad_revenue', message: '収益は0以上の数で指定してください。' }, 400) };
  }
  let rate = (ownerRate === undefined || ownerRate === null)
    ? DEFAULT_OWNER_RATE : Number(ownerRate);
  if (!isFinite(rate) || rate < 0 || rate > 1) {
    return { error: json({ error: 'bad_rate', message: '運営者の取り分は 0〜1 で指定してください。' }, 400) };
  }

  await aggregate(d, period, now);

  const t = await d.prepare(
    'SELECT SUM(points) AS p FROM points WHERE period = ?1').bind(period).first();
  const total = Number(t && t.p) || 0;
  if (total <= 0) {
    return { error: json({
      error: 'no_points',
      period,
      message: 'この期間にはポイントがありません。1ポイントあたりの金額を決められません。',
      確かめること: [
        'その期間に読書ログ(reads)があるか',
        '読まれた作品の works_meta に持ち主(owner_email)が入っているか',
        '滞在30秒未満の記録しかない場合、ポイントは発生しません',
      ],
    }, 409) };
  }
  const share = rev * (1 - rate);
  const perPoint = total > 0 ? share / total : 0;

  await d.prepare(
    `UPDATE points SET amount_yen = ROUND(points * ?2, 4), computed_at = ?3
      WHERE period = ?1 AND confirmed = 0`).bind(period, perPoint, now).run();

  await d.prepare(
    `INSERT INTO periods (period, revenue_yen, owner_rate, total_points, yen_per_point, confirmed, computed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
     ON CONFLICT(period) DO UPDATE SET
       revenue_yen   = ?2,
       owner_rate    = ?3,
       total_points  = ?4,
       yen_per_point = ?5,
       computed_at   = ?6
     WHERE periods.confirmed = 0`).bind(period, rev, rate, total, perPoint, now).run();

  return { ok: true, total, share, perPoint, rate, rev };
}

/** その作者の未払い残高。締めた期間の金額の合計 − 支払った額の合計。 */
async function balanceOf(d, email) {
  const a = await d.prepare(
    'SELECT SUM(amount_yen) AS y FROM points WHERE author_email = ?1 AND confirmed = 1'
  ).bind(email).first();
  const b = await d.prepare(
    'SELECT SUM(amount_yen) AS y FROM payouts WHERE author_email = ?1').bind(email).first();
  return r2((Number(a && a.y) || 0) - (Number(b && b.y) || 0));
}

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
async function backfill(env, d, defaultOwner) {
  const kv = env.WORKS || env.WORKS_KV;
  if (!kv) return json({ error: 'no_kv' }, 500);

  // KV に持ち主が入っていない作品の逃げ先。指定が無ければ持ち主なしのまま。
  // すでに持ち主がいる作品には使わない。人の作品を奪わないため。
  const fallback = defaultOwner ? String(defaultOwner).trim().toLowerCase() : null;
  if (defaultOwner && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fallback)) {
    return json({ error: 'bad_owner', message: 'defaultOwner はメールアドレスの形で指定してください。' }, 400);
  }

  let catalog;
  try {
    const raw = await kv.get('__catalog__');
    catalog = raw ? JSON.parse(raw) : null;
  } catch (e) {
    return json({ error: 'catalog_unreadable', message: String(e && e.message) }, 500);
  }
  // __catalog__ は配列で入っている（/api/catalog.js と同じ読み方）。
  // 念のため { works: [...] } の形も受ける。
  const works = Array.isArray(catalog) ? catalog
              : (catalog && Array.isArray(catalog.works) ? catalog.works : []);
  if (!works.length) {
    return json({ ok: true, 取り込んだ作品: 0, 持ち主が分からない作品: 0,
      注意: 'KV の __catalog__ に作品がありませんでした。KV バインディング(WORKS)を確認してください。',
      done: [], skipped: [] });
  }
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

    // KV に無いときだけ逃げ先を使う。KV にある持ち主は必ず優先する。
    let fromFallback = false;
    if (!owner && fallback) { owner = fallback; fromFallback = true; }

    try {
      // 文字数は、読み切るのに要する最短時間の算出に使う（_d1.js 参照）。
      // これが無い作品は既定の300秒で見積もるため、水増しに少し甘くなる。
      const chars = Number(w.charCount) > 0 ? Math.round(Number(w.charCount)) : null;
      await d.prepare(
        `INSERT INTO works_meta (work_id, owner_email, title, status, created_at, published_at, last_edited_at, char_count, title_en)
         VALUES (?1, ?2, ?3, 'published', ?4, ?4, ?5, ?6, ?7)
         ON CONFLICT(work_id) DO UPDATE SET
           owner_email = COALESCE(?2, owner_email),
           title       = COALESCE(?3, title),
           status      = COALESCE('published', status),
           char_count  = COALESCE(?6, char_count),
           title_en    = COALESCE(?7, title_en)`
      ).bind(w.id, owner, w.title || null, created || now, now, chars, w.titleEn || null).run();
      (owner ? done : skipped).push({ id: w.id, title: w.title, owner,
                                      指定で補った: fromFallback || undefined,
                                      文字数: chars || '不明' });
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

  // 作者ごとの未払い残高。支払いの判断に使う。
  if (url.searchParams.get('balances')) {
    try {
      const rows = await d.prepare(
        `SELECT e.author_email,
                ROUND(COALESCE(e.earned, 0) - COALESCE(pd.paid, 0), 2) AS balance_yen,
                ROUND(COALESCE(e.earned, 0), 2) AS earned_yen,
                COALESCE(pd.paid, 0) AS paid_yen
           FROM (SELECT author_email, SUM(amount_yen) AS earned
                   FROM points WHERE confirmed = 1 GROUP BY author_email) e
           LEFT JOIN (SELECT author_email, SUM(amount_yen) AS paid
                        FROM payouts GROUP BY author_email) pd
             ON pd.author_email = e.author_email
          ORDER BY balance_yen DESC`).all();
      const list = (rows && rows.results) || [];
      return json({
        rows: list.map((r) => Object.assign({}, r, {
          支払える額: Math.floor((Number(r.balance_yen) || 0) / 1000) * 1000,
        })),
        注意: '支払えるのは1,000円単位です。端数は次期へ繰り越します。',
      });
    } catch (e) {
      return json({ error: 'query_failed', message: String(e && e.message) }, 500);
    }
  }

  const period = url.searchParams.get('period') || jstMonth();
  try {
    const rows = await d.prepare(
      `SELECT p.period, p.author_email, p.work_id, w.title, p.points, p.reads_count,
              p.amount_yen, p.confirmed, p.computed_at
         FROM points p LEFT JOIN works_meta w ON w.work_id = p.work_id
        WHERE p.period = ?1
        ORDER BY p.points DESC`).bind(period).all();
    const list = (rows && rows.results) || [];
    const total = list.reduce((a, r) => a + (Number(r.points) || 0), 0);
    const money = list.reduce((a, r) => a + (Number(r.amount_yen) || 0), 0);
    const pr = await d.prepare('SELECT * FROM periods WHERE period = ?1').bind(period).first();
    return json({ period, 合計ポイント: Math.round(total * 10000) / 10000,
                  分配額の合計: r2(money),
                  収益: pr ? pr.revenue_yen : null,
                  運営者の取り分: pr ? pr.owner_rate : null,
                  '1ポイントあたり': pr ? pr.yen_per_point : null,
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

  if (body.backfill) return backfill(context.env, d, body.defaultOwner);

  const period = String(body.period || jstMonth()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return json({ error: 'bad_period', message: '期間は YYYY-MM の形で指定してください。' }, 400);
  }
  const now = new Date().toISOString();

  // 支払った記録を残す
  if (body.payout) {
    const em = String(body.payout.email || '').trim().toLowerCase();
    const amt = Math.floor(Number(body.payout.amountYen) || 0);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      return json({ error: 'bad_email', message: 'email を正しく指定してください。' }, 400);
    }
    if (!(amt > 0) || amt % 1000 !== 0) {
      return json({ error: 'bad_amount', message: '支払いは1,000円単位で指定してください。' }, 400);
    }
    try {
      const before = await balanceOf(d, em);
      if (amt > before) {
        return json({ error: 'over_balance',
          message: '未払い残高(' + before + '円)を超える額は記録できません。' }, 409);
      }
      await d.prepare(
        `INSERT INTO payouts (author_email, amount_yen, paid_at, method, note)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      ).bind(em, amt, now, String(body.payout.method || 'giftcard').slice(0, 40),
             String(body.payout.note || '').slice(0, 200)).run();
      return json({ ok: true, email: em, 支払った額: amt, 残りの未払い: await balanceOf(d, em) });
    } catch (e) {
      return json({ error: 'payout_failed', message: String(e && e.message) }, 500);
    }
  }

  // 収益だけ入れて金額を計算する（締めはしない）
  if (body.revenue !== undefined && !body.confirm) {
    const r = await applyRevenue(d, period, body.revenue, body.ownerRate, now);
    if (r.error) return r.error;
    return json({ ok: true, period,
                  収益: r.rev, 運営者の取り分: r.rate,
                  分配できる額: r2(r.share), 合計ポイント: r2(r.total),
                  '1ポイントあたり': r.perPoint,
                  注意: 'まだ締めていません。再計算すると変わります。' });
  }

  // 締める。収益が渡されていれば金額も確定させる。
  if (body.confirm) {
    try {
      let applied = null;
      if (body.revenue !== undefined) {
        const r = await applyRevenue(d, period, body.revenue, body.ownerRate, now);
        if (r.error) return r.error;
        applied = r;
      }
      const r = await d.prepare(
        'UPDATE points SET confirmed = 1 WHERE period = ?1 AND confirmed = 0').bind(period).run();
      await d.prepare(
        `INSERT INTO periods (period, confirmed, computed_at) VALUES (?1, 1, ?2)
         ON CONFLICT(period) DO UPDATE SET confirmed = 1, computed_at = ?2`).bind(period, now).run();
      const sum = await d.prepare(
        'SELECT SUM(points) AS p, SUM(amount_yen) AS y FROM points WHERE period = ?1'
      ).bind(period).first();
      return json({ ok: true, period, 締めた行数: (r && r.meta && r.meta.changes) || 0,
                    合計ポイント: r2(sum && sum.p), 分配額の合計: r2(sum && sum.y),
                    '1ポイントあたり': applied ? applied.perPoint : undefined,
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
    await aggregate(d, period, now);
    const rows = await d.prepare(
      `SELECT p.author_email, p.work_id, w.title, p.points, p.reads_count, p.confirmed
         FROM points p LEFT JOIN works_meta w ON w.work_id = p.work_id
        WHERE p.period = ?1 ORDER BY p.points DESC`).bind(period).all();
    const list = (rows && rows.results) || [];
    const total = list.reduce((a, r) => a + (Number(r.points) || 0), 0);
    return json({ ok: true, period, computed_at: now,
                  合計ポイント: Math.round(total * 10000) / 10000,
                  作品数: list.length,
                  注意: list.length ? undefined
                    : 'この期間にはポイントがありません。読書ログが無いか、'
                      + '読まれた作品に持ち主(owner_email)が入っていないか、'
                      + '滞在30秒未満の記録しかありません。',
                  rows: list });
  } catch (e) {
    return json({ error: 'aggregate_failed', message: String(e && e.message) }, 500);
  }
}
