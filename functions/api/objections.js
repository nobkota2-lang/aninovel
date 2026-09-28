/**
 * 読者による公開差し止め請求  /api/objections
 * ============================================================
 *   POST … 読者が「この作品の公開を止めてほしい」と申し出る
 *   GET  … 自分が出した請求の控え（読者用。オーナー用は /api/admin/objections）
 *
 * なぜ「自動で止める」作りにしないのか
 *   件数で自動停止にすると、嫌がらせで他人の作品を落とせてしまう。
 *   請求はあくまで運営者への申し出として積み、止めるかどうかは人が決める。
 *   ただし件数の多い作品が上に来るようにして、見落とさないようにする。
 *
 * 誰が出せるか
 *   ログインしていなくても出せる。作品を読んで問題に気づくのは、
 *   立ち読みの読者であることも多いため。
 *   代わりに、同じ人が同じ作品へ何度も出しても1件として数える。
 *   ログイン中ならメールアドレス、そうでなければ IP を伏せた印で見分ける。
 *
 * KV のキー
 *   obj:<作品ID>:<申出者の印>  … 請求1件
 *   objidx:<作品ID>            … その作品の集計 {count, reasons, first, last}
 *   __objections__             … 作品ごとの集計の一覧（オーナー用）
 */

import { kvOf, currentUser, normEmail } from '../_authlib.js';

const REASONS = {
  obscene:    '公序良俗に反する表現・画像',
  minor:      '未成年者を性的に描いている',
  violence:   '過度に残虐な描写',
  hate:       '差別・憎悪をあおる内容',
  illegal:    '違法行為を助長する内容',
  selfharm:   '自傷・自殺を誘引する内容',
  copyright:  '他人の著作物の無断使用',
  privacy:    '実在の個人を特定できる情報',
  other:      'その他',
};

const KEEP_DAYS = 400;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** 申出者を見分ける印。IP そのものは残さない。 */
async function reporterMark(request, env, user) {
  if (user && user.email) return 'u:' + normEmail(user.email);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const salt = (env && env.OBJECTION_SALT) || 'aninovel-objection';
  const buf = new TextEncoder().encode(salt + '|' + ip);
  const h = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'a:' + hex.slice(0, 16);
}

const idxKey = id => 'objidx:' + id;
const ALL_KEY = '__objections__';

async function readIdx(store, workId) {
  try {
    const raw = await store.get(idxKey(workId));
    const o = raw ? JSON.parse(raw) : null;
    return (o && typeof o === 'object') ? o : null;
  } catch (e) { return null; }
}

async function readAll(store) {
  try {
    const raw = await store.get(ALL_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const store = kvOf(env);
  if (!store) return json({ error: 'kv_unbound', message: 'いま受け付けられません。' }, 500);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const workId = String((body && body.workId) || '').trim().slice(0, 100);
  const reasonId = String((body && body.reasonId) || '').trim();
  const comment = String((body && body.comment) || '').trim().slice(0, 2000);

  if (!workId) return json({ error: 'bad_work', message: '対象の作品が分かりません。' }, 400);
  if (!REASONS[reasonId]) {
    return json({ error: 'bad_reason', message: '理由を選んでください。' }, 400);
  }
  // 「その他」を選んだときは、何が問題かを書いてもらう。
  if (reasonId === 'other' && comment.length < 10) {
    return json({
      error: 'comment_required',
      message: '「その他」を選んだ場合は、どこがどう問題かを具体的にお書きください。',
    }, 400);
  }

  let user = null;
  try { user = await currentUser(request, env); } catch (e) { user = null; }
  const mark = await reporterMark(request, env, user);

  const now = new Date().toISOString();
  const key = 'obj:' + workId + ':' + mark;
  const existing = await store.get(key);

  const rec = {
    workId, reasonId, comment,
    reporter: user ? 'member' : 'guest',
    at: now,
    resent: !!existing,
  };
  await store.put(key, JSON.stringify(rec), { expirationTtl: KEEP_DAYS * 24 * 60 * 60 });

  // 同じ人の出し直しは件数を増やさない
  const idx = (await readIdx(store, workId)) || { workId, count: 0, reasons: {}, first: now, last: now, handled: false };
  if (!existing) idx.count += 1;
  idx.reasons[reasonId] = (idx.reasons[reasonId] || 0) + (existing ? 0 : 1);
  idx.last = now;
  idx.handled = false;          // 新しい請求が来たら、また見てもらう
  await store.put(idxKey(workId), JSON.stringify(idx));

  // オーナー用の一覧を更新（件数の多い順に並べ替える）
  const all = await readAll(store);
  const i = all.findIndex(e => e && e.workId === workId);
  const row = { workId, count: idx.count, reasons: idx.reasons, first: idx.first, last: idx.last, handled: false };
  if (i >= 0) all[i] = row; else all.push(row);
  all.sort((a, b) => (b.count - a.count) || String(b.last).localeCompare(String(a.last)));
  if (all.length > 500) all.length = 500;
  await store.put(ALL_KEY, JSON.stringify(all));

  return json({
    ok: true,
    alreadySent: !!existing,
    message: existing
      ? 'すでに受け付けています。内容を更新しました。運営者が確認します。'
      : '受け付けました。運営者が内容を確認します。ご協力ありがとうございます。',
  });
}

/** 理由の一覧（画面で選択肢を作るため） */
export async function onRequestGet() {
  return json({ ok: true, reasons: REASONS });
}

export { REASONS, readIdx, readAll, idxKey, ALL_KEY };
