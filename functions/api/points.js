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
 * 当月は台帳を見ない（2026-10-03）
 *   ポイント台帳(points)は、運営者が集計を走らせたときに書かれる。
 *   台帳だけを見せると、作者は集計されるまで自分の今月を見られない。
 *   「いま何点か」が分からないのでは、画面を置く意味が薄い。
 *
 *   そこで当月は読書ログ(reads)から直接計算して見せる。
 *   式は運営者の集計と同じもの(_d1.js の SCORE_SQL)を使う。
 *   ただし締め済み(confirmed=1)の期間は台帳の値をそのまま出す。
 *   支払いの根拠にした数字は、後から動いて見えてはいけない。
 *
 * ポイントと金額（2026-10-03 決定）
 *   1ポイント＝1円ではない。1ポイントがいくらになるかは期間ごとに変わり、
 *   その期間の収益から運営者の取り分を引いた額を、総ポイントで割って決まる。
 *   ポイントは「どれだけ読まれたか」の指標として見せる。
 *
 *   金額そのものは原則として見せない。見せると、まだ確定していない
 *   単価を当てにされてしまう。1,000円に達して実際にお支払いできる
 *   ようになったときだけ、その額をお知らせする。
 *   これより詳しい内訳は、請求があればお見せする（利用規約 第9条）。
 *
 * 見せる範囲
 *   自分が owner_email になっている作品だけ。他の作者の数字は返さない。
 *   オーナーも、この口では自分の分しか見えない（全体は /api/admin/points）。
 *
 * 使い方
 *   GET /api/points                 … 当月の暫定値と、過去12か月の履歴
 *   GET /api/points?period=2026-09  … その期間だけ
 */

import { requireWriter, json } from '../_owner.js';
import { db, jstMonth, SCORE_SQL, SCORE_NOTE_JA, SCORE_NOTE_EN } from '../_d1.js';

/** 当月ぶんを読書ログから直接計算する */
const LIVE = `
SELECT r.work_id, w.title, w.title_en,
       ROUND(SUM(${SCORE_SQL}), 4) AS points,
       SUM(CASE WHEN r.seconds < 30 THEN 0 ELSE 1 END) AS reads_count
  FROM reads r
  JOIN works_meta w ON w.work_id = r.work_id
 WHERE w.owner_email = ?1
   AND substr(r.day, 1, 7) = ?2
 GROUP BY r.work_id
HAVING points > 0
 ORDER BY points DESC`;

/** 台帳から読む（過去の期間） */
const LEDGER = `
SELECT p.period, p.work_id, w.title, w.title_en, p.points, p.reads_count, p.confirmed, p.computed_at
  FROM points p
  LEFT JOIN works_meta w ON w.work_id = p.work_id
 WHERE p.author_email = ?1
   AND p.period >= ?2
 ORDER BY p.period DESC, p.points DESC`;

const LEDGER_ONE = `
SELECT p.period, p.work_id, w.title, w.title_en, p.points, p.reads_count, p.confirmed, p.computed_at
  FROM points p
  LEFT JOIN works_meta w ON w.work_id = p.work_id
 WHERE p.author_email = ?1
   AND p.period = ?2
 ORDER BY p.points DESC`;

const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/** お支払いの最低額。これに満たない分は次の期間へ繰り越す。 */
const MIN_PAYOUT_YEN = 1000;

/**
 * お支払いできる分があるか。
 * 残高そのものは返さない。1,000円に達して初めて、その額を知らせる。
 */
async function payoutState(d, me) {
  try {
    const a = await d.prepare(
      'SELECT SUM(amount_yen) AS y FROM points WHERE author_email = ?1 AND confirmed = 1'
    ).bind(me).first();
    const b = await d.prepare(
      'SELECT SUM(amount_yen) AS y FROM payouts WHERE author_email = ?1').bind(me).first();
    const bal = (Number(a && a.y) || 0) - (Number(b && b.y) || 0);
    const payable = Math.floor(bal / MIN_PAYOUT_YEN) * MIN_PAYOUT_YEN;
    if (payable >= MIN_PAYOUT_YEN) {
      return { ready: true, amountYen: payable, minimumYen: MIN_PAYOUT_YEN };
    }
    return { ready: false, amountYen: null, minimumYen: MIN_PAYOUT_YEN };
  } catch (e) {
    return { ready: false, amountYen: null, minimumYen: MIN_PAYOUT_YEN };
  }
}

/** 12か月前の YYYY-MM */
function twelveMonthsAgo() {
  const [y, m] = jstMonth().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - 11, 1)).toISOString().slice(0, 7);
}

/** 台帳の行を期間ごとにまとめる */
function groupByPeriod(rows) {
  const by = {};
  for (const r of rows) {
    const p = by[r.period] || (by[r.period] = {
      period: r.period, points: 0, reads: 0, confirmed: true, 暫定: false, works: [],
    });
    p.points += Number(r.points) || 0;
    p.reads += Number(r.reads_count) || 0;
    if (r.confirmed !== 1) p.confirmed = false;
    p.works.push({
      workId: r.work_id, title: r.title, titleEn: r.title_en || null,
      points: r4(r.points), reads: Number(r.reads_count) || 0,
    });
  }
  return Object.values(by)
    .map((p) => ({ ...p, points: r4(p.points) }))
    .sort((a, b) => b.period.localeCompare(a.period));
}

export async function onRequestGet(context) {
  const g = await requireWriter(context); if (g.deny) return g.deny;
  const me = String(g.who.email || '').toLowerCase();

  const d = db(context.env);
  if (!d) {
    // D1 がまだ無い間は「0件」ではなく「まだ数えていない」と返す。
    // 0件と出すと、読まれていないのだと誤解させてしまう。
    return json({
      unavailable: true, email: me, 当月: jstMonth(), current: null, periods: [],
      message: 'ポイントの集計はまだ始まっていません。',
      数え方: SCORE_NOTE_JA, howCounted: SCORE_NOTE_EN,
    });
  }

  const url = new URL(context.request.url);
  const asked = url.searchParams.get('period');
  const month = jstMonth();

  try {
    // ---- 期間の指定があるとき ----
    if (asked) {
      if (!/^\d{4}-\d{2}$/.test(asked)) {
        return json({ error: 'bad_period', message: '期間は YYYY-MM の形で指定してください。' }, 400);
      }
      const led = await d.prepare(LEDGER_ONE).bind(me, asked).all();
      const rows = (led && led.results) || [];
      const confirmed = rows.length > 0 && rows.every((r) => r.confirmed === 1);
      // 締めていない期間は、台帳より読書ログのほうが新しい
      if (!confirmed) {
        const live = await d.prepare(LIVE).bind(me, asked).all();
        const lr = (live && live.results) || [];
        return json({
          email: me, period: asked, 暫定: true, confirmed: false,
          合計ポイント: r4(lr.reduce((a, x) => a + (Number(x.points) || 0), 0)),
          works: lr.map((x) => ({ workId: x.work_id, title: x.title, titleEn: x.title_en || null,
                                  points: r4(x.points), reads: Number(x.reads_count) || 0 })),
          数え方: SCORE_NOTE_JA, howCounted: SCORE_NOTE_EN,
        });
      }
      const g1 = groupByPeriod(rows)[0];
      return json({ email: me, period: asked, 暫定: false, confirmed: true,
                    合計ポイント: g1.points, works: g1.works,
                    数え方: SCORE_NOTE_JA, howCounted: SCORE_NOTE_EN });
    }

    // ---- 既定: 当月の暫定値 ＋ 過去12か月の履歴 ----
    const [liveRes, ledRes] = await Promise.all([
      d.prepare(LIVE).bind(me, month).all(),
      d.prepare(LEDGER).bind(me, twelveMonthsAgo()).all(),
    ]);

    const liveRows = (liveRes && liveRes.results) || [];
    const ledRows = ((ledRes && ledRes.results) || []);

    // 当月が締め済みなら、台帳の値がそのまま答え。動かさない。
    const thisMonthLedger = ledRows.filter((r) => r.period === month);
    const thisMonthConfirmed =
      thisMonthLedger.length > 0 && thisMonthLedger.every((r) => r.confirmed === 1);

    let current;
    if (thisMonthConfirmed) {
      const g1 = groupByPeriod(thisMonthLedger)[0];
      current = { period: month, 暫定: false, confirmed: true,
                  points: g1.points, reads: g1.reads, works: g1.works };
    } else {
      current = {
        period: month, 暫定: true, confirmed: false,
        points: r4(liveRows.reduce((a, x) => a + (Number(x.points) || 0), 0)),
        reads: liveRows.reduce((a, x) => a + (Number(x.reads_count) || 0), 0),
        works: liveRows.map((x) => ({ workId: x.work_id, title: x.title, titleEn: x.title_en || null,
                                      points: r4(x.points), reads: Number(x.reads_count) || 0 })),
      };
    }

    // 履歴は当月を除く（当月は current に出している）
    const periods = groupByPeriod(ledRows.filter((r) => r.period !== month));

    return json({
      email: me,
      当月: month,
      current,
      periods,
      累計ポイント: r4(current.points + periods.reduce((a, p) => a + p.points, 0)),
      payout: await payoutState(d, me),
      数え方: SCORE_NOTE_JA,
      howCounted: SCORE_NOTE_EN,
      注記: '当月は暫定です。月が締まると確定し、以後は変わりません。',
      note: 'The current month is provisional. It is finalised when the month is closed.',
      単価について: 'ポイントは、どれだけ読まれたかの目安です。1ポイント＝1円ではありません。'
        + '1ポイントあたりの金額は、その期間の収益から運営者の取り分を引いた額を、'
        + 'その期間の総ポイントで割って決まるため、期間ごとに変わります。'
        + 'お支払いできる分が1,000円に達すると、この画面でお知らせします。',
      aboutValue: 'Points measure how much your work was read. One point is not one yen. '
        + 'The value of a point is set for each period by dividing the revenue remaining after '
        + "the operator's share by the total points for that period, so it varies between periods. "
        + 'When your payable balance reaches 1,000 yen, this page will tell you.',
    });
  } catch (e) {
    return json({ error: 'query_failed', message: String(e && e.message) }, 500);
  }
}
