/**
 * 読書の記録と、立ち読みの上限  /api/reading
 * ============================================================
 *   POST { action:'open',     workId }
 *        … その作品を開いてよいかを返す。登録なしの読者は1日5作品まで。
 *          同じ日にもう一度開いた作品は、上限を消費しない。
 *
 *   POST { action:'progress', workId, seconds, progress, finished }
 *        … 読んだ量を記録する。ポイントの元になる。
 *          同じ読者の同じ作品は1日1行。2回目以降は足し込む。
 *
 * 落ちても読書を止めない
 *   D1 がまだ無い、数え上げに失敗した、といった場合は
 *   「読める」を返す。上限の判定ができないからといって読者を
 *   締め出すのは、取りこぼしよりも損が大きい。
 *
 * 数えない相手
 *   ・登録会員（読み放題。ただし読書ログは取る＝ポイントの元）
 *   ・下書き（draft_）… そもそも公開されていない
 *
 * 水増しへの守り（2026-10-03 追加）
 *   ポイントは収益分配の根拠になるので、申告をそのまま信じない。
 *
 *   1) 滞在秒数と進み具合は、サーバー側で測った実経過時間で頭打ちにする。
 *      作品を読み切るのに要する最短時間は文字数から出す（_d1.js 参照）。
 *   2) 登録なしの読者は、その日「開いてよい」と判定された作品だけ記録する。
 *      これが無いと、progress を直接投げるだけで1日5作品の上限を
 *      通さずに全作品ぶん記録できた。
 *   3) 自ら名乗っているボットは記録しない。
 *      名乗らないボットには効かないが、素朴なものは落ちる。
 *
 *   いずれも「読ませない」ではなく「数えない」。読むことは妨げない。
 */

import { currentUser } from '../_authlib.js';
import { whoAmI, hasRole } from '../_owner.js';
import {
  db, readerMark, checkPeek, logRead, touchMember, jstDay, peekSeen, PEEK_LIMIT,
} from '../_d1.js';
import { sameSite, denyHotlink } from '../_origin.js';

// 自ら名乗っているボット。読むのは妨げないが、ポイントには数えない。
// ブラウザ名を詐称されれば抜けられる。素朴なものを落とすための網。
const BOT_UA = /bot|crawler|crawl|spider|slurp|curl|wget|python-requests|python-urllib|httpie|okhttp|libwww|java\/|go-http-client|axios|node-fetch|scrapy|headless|phantomjs|puppeteer|playwright|selenium/i;

function looksLikeBot(request) {
  const ua = request.headers.get('User-Agent') || '';
  if (!ua) return true;               // 名乗らない相手も数えない
  return BOT_UA.test(ua);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 他所のページから呼ばれる筋合いはない
  if (!sameSite(request)) return denyHotlink('読書の記録');

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const action = String((body && body.action) || 'open');
  const workId = String((body && body.workId) || '').trim().slice(0, 100);
  if (!workId) return json({ error: 'bad_work', message: '作品が分かりません。' }, 400);

  // 下書きは公開されていない。数えることも記録することもしない。
  if (workId.indexOf('draft_') === 0 || workId.indexOf('my_') === 0) {
    return json({ ok: true, allowed: true, counted: false, reason: 'draft' });
  }

  let user = null;
  try { user = await currentUser(request, env); } catch (e) { user = null; }
  const reader = await readerMark(request, env, user);

  // 作者本人とオーナーは数えない
  let privileged = false;
  if (user) {
    try {
      const who = await whoAmI(request, env);
      privileged = hasRole(who, 'owner');
    } catch (e) {}
  }

  if (action === 'progress') {
    // 自ら名乗っているボットは数えない
    if (looksLikeBot(request)) {
      return json({ ok: true, recorded: false, skipped: true, reason: 'bot' });
    }
    // 登録なしの読者は、その日「開いてよい」と判定された作品だけ。
    // 作品を開く手順を踏まずに記録だけ投げる経路を塞ぐ。
    if (!user) {
      const opened = await peekSeen(env, reader, workId);
      if (!opened) {
        return json({ ok: true, recorded: false, skipped: true, reason: 'not_opened' });
      }
    }
    const r = await logRead(env, reader, workId, {
      seconds: body.seconds, progress: body.progress, finished: body.finished,
    });
    if (user) {
      // 「最後に読んだ日」を更新する。3か月の判定に使う。
      context.waitUntil
        ? context.waitUntil(touchMember(env, user.email, user.isAuthor ? 'author' : 'reader'))
        : await touchMember(env, user.email, user.isAuthor ? 'author' : 'reader');
    }
    return json({ ok: !!r.ok, recorded: !!r.ok, skipped: !!r.skipped });
  }

  // ---- action === 'open' ----

  // 登録会員は読み放題。上限を数えない。
  if (user) {
    return json({
      ok: true, allowed: true, counted: false, member: true,
      limit: null, remaining: null,
      reason: privileged ? 'owner' : 'member',
    });
  }

  const peek = await checkPeek(env, request, reader, workId);
  return json({
    ok: true,
    allowed: peek.allowed,
    counted: peek.counted,
    member: false,
    used: peek.used,
    limit: peek.limit,
    remaining: peek.remaining,
    unavailable: !!peek.unavailable,
    message: peek.allowed ? null
      : '登録なしで読める作品は1日' + PEEK_LIMIT + '作品までです。'
        + '無料の読者会員にご登録いただくと、作品数の制限なくお読みいただけます。',
  });
}

/** 残り作品数だけを見る（数を消費しない）。画面の案内に使う。 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!sameSite(request)) return denyHotlink('読書の記録');

  let user = null;
  try { user = await currentUser(request, env); } catch (e) { user = null; }
  if (user) {
    return json({ ok: true, member: true, limit: null, remaining: null });
  }
  const d = db(env);
  if (!d) return json({ ok: true, member: false, limit: PEEK_LIMIT, remaining: PEEK_LIMIT, unavailable: true });

  const reader = await readerMark(request, env, null);
  try {
    const row = await d.prepare(
      'SELECT COUNT(*) AS n FROM peek_counts WHERE reader = ?1 AND day = ?2'
    ).bind(reader, jstDay()).first();
    const used = (row && Number(row.n)) || 0;
    return json({ ok: true, member: false, used, limit: PEEK_LIMIT,
                  remaining: Math.max(0, PEEK_LIMIT - used) });
  } catch (e) {
    return json({ ok: true, member: false, limit: PEEK_LIMIT, remaining: PEEK_LIMIT, unavailable: true });
  }
}
