/**
 * 作者への指摘・感想  /api/feedback
 * ============================================================
 *   POST  … 読者が作品の作者へ、誤字脱字・矛盾の指摘や感想を送る
 *   GET   … 作者が自分の作品に届いたものを読む(オーナーは全作品)
 *   PATCH … 作者/オーナーが「対応済み」「非表示」に印を付ける
 *
 * なぜ公開しないのか
 *   指摘は作品を良くするための材料で、晒し上げるものではない。
 *   公開すると、指摘への反論や便乗が始まり、掲示板のような
 *   言い合いになりやすい。そこで届け先は作者(とオーナー)だけにし、
 *   返信の仕組みも持たない。作者は直すことで応える。
 *
 * 誰が送れるか
 *   ログインしていなくても送れる。誤字に気づくのは立ち読みの読者も多い。
 *   代わりに、1人あたり1日の件数に上限を設ける(ログイン中は多め)。
 *   送り主を見分ける印は、ログイン中ならメール、そうでなければ IP を
 *   塩付きでハッシュした値。IP そのものは残さない。作者には送り主を見せない。
 *
 * KV のキー
 *   fb:<作品ID>:<逆順時刻>:<乱数>  … 1件(新しい順に並ぶよう時刻を逆順にする)
 *   fbrl:<送り主の印>:<日付>        … その日に送った件数(翌日に消える)
 */

import { kvOf, currentUser, normEmail } from '../_authlib.js';
import { whoAmI, hasRole } from '../_owner.js';
import { db } from '../_d1.js';

const KINDS = {
  typo:      { ja: '誤字・脱字',            en: 'Typo / missing word' },
  conflict:  { ja: '矛盾・設定のずれ',      en: 'Inconsistency' },
  fact:      { ja: '事実・用語の誤り',      en: 'Factual error' },
  impression:{ ja: '感想',                  en: 'Impression' },
  request:   { ja: '要望・提案',            en: 'Suggestion' },
  other:     { ja: 'その他',                en: 'Other' },
};
const KEEP_DAYS = 400;
const LIMIT_GUEST = 10;     // 未ログインの1日の上限
const LIMIT_MEMBER = 30;    // ログイン中の1日の上限
const MAX_TEXT = 1000;
const MAX_QUOTE = 300;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function senderMark(request, env, user) {
  if (user && user.email) return 'u:' + normEmail(user.email);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const salt = (env && env.OBJECTION_SALT) || 'aninovel-feedback';
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|fb|' + ip));
  return 'a:' + Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function clean(s, n) {
  return String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, n);
}

// 宣伝・荒らしの典型だけを止める。正当な指摘を落とさないよう、ゆるくしてある。
function looksLikeSpam(t) {
  if (/https?:\/\/|www\.|\.com\b|\.net\b|\.jp\b/i.test(t)) return true;
  if (/(.)\1{14,}/.test(t)) return true;
  return false;
}

/** 作品の持ち主(作者のメール)。分からなければ null = オーナー扱い。 */
async function workOwner(env, workId) {
  const d = db(env);
  if (d) {
    try {
      const r = await d.prepare('SELECT owner_email FROM works_meta WHERE work_id = ?1').bind(workId).first();
      if (r && r.owner_email) return String(r.owner_email).toLowerCase();
    } catch (e) {}
  }
  return null;
}

/** 自分が持ち主の作品ID一覧(D1)。 */
async function myWorkIds(env, email) {
  const d = db(env);
  if (!d) return [];
  try {
    const rows = await d.prepare('SELECT work_id FROM works_meta WHERE owner_email = ?1').bind(email).all();
    return ((rows && rows.results) || []).map(r => r.work_id);
  } catch (e) { return []; }
}

function revTs(ms) { return String(9999999999999 - ms).padStart(13, '0'); }

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'kv_unbound', message: 'いま受け付けられません。' }, 500);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const workId = clean(body.workId, 100);
  const kind = clean(body.kind, 20);
  const text = clean(body.text, MAX_TEXT);
  const quote = clean(body.quote, MAX_QUOTE);
  const itemId = clean(body.itemId, 80);
  const page = Number.isFinite(+body.page) ? Math.max(0, Math.floor(+body.page)) : null;
  const lang = body.lang === 'en' ? 'en' : 'ja';

  if (!workId) return json({ error: 'bad_work', message: '対象の作品が分かりません。' }, 400);
  if (!KINDS[kind]) return json({ error: 'bad_kind', message: '種類を選んでください。' }, 400);
  if (text.length < 2) return json({ error: 'too_short', message: '内容を書いてください。' }, 400);
  if (looksLikeSpam(text) || looksLikeSpam(quote)) {
    return json({ error: 'spam', message: 'URLを含む投稿や、同じ文字の繰り返しは受け付けていません。' }, 400);
  }

  let user = null;
  try { user = await currentUser(request, env); } catch (e) { user = null; }
  const mark = await senderMark(request, env, user);

  // 1日の上限
  const day = new Date().toISOString().slice(0, 10);
  const rlKey = 'fbrl:' + mark + ':' + day;
  const used = parseInt((await kv.get(rlKey)) || '0', 10) || 0;
  const limit = user ? LIMIT_MEMBER : LIMIT_GUEST;
  if (used >= limit) {
    return json({ error: 'rate_limited', message: '本日の送信数の上限に達しました。明日またお送りください。' }, 429);
  }

  const now = Date.now();
  const id = revTs(now) + ':' + crypto.randomUUID().slice(0, 8);
  const rec = {
    id, workId, kind, text, quote, itemId, page, lang,
    from: user ? 'member' : 'guest',
    // 作者には送り主を見せない。同じ人の投稿をまとめて見分けるための短い印だけ持つ。
    sender: mark.slice(0, 2) + mark.slice(-6),
    at: new Date(now).toISOString(),
    status: 'new',
  };
  await kv.put('fb:' + workId + ':' + id, JSON.stringify(rec), { expirationTtl: KEEP_DAYS * 86400 });
  await kv.put(rlKey, String(used + 1), { expirationTtl: 2 * 86400 });

  return json({ ok: true, message: '作者に届けました。ありがとうございます。' });
}

/** 届いた指摘を読む。?workId= で絞り込み。作者は自分の作品だけ、オーナーは全作品。 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.searchParams.get('kinds') === '1') return json({ ok: true, kinds: KINDS });

  const kv = kvOf(env);
  if (!kv) return json({ error: 'kv_unbound' }, 500);
  const who = await whoAmI(request, env);
  if (!who) return json({ error: 'unauthorized', message: 'ログインが必要です。' }, 401);
  const isOwner = hasRole(who, 'owner');
  if (!isOwner && !hasRole(who, 'author')) return json({ error: 'forbidden', message: '作者のアカウントが必要です。' }, 403);

  const want = clean(url.searchParams.get('workId'), 100);
  const showHidden = url.searchParams.get('hidden') === '1';
  let ids;
  if (want) {
    if (!isOwner) {
      const own = await workOwner(env, want);
      if (own !== String(who.email).toLowerCase()) return json({ error: 'forbidden', message: 'この作品の作者ではありません。' }, 403);
    }
    ids = [want];
  } else if (isOwner) {
    ids = null; // 全件
  } else {
    ids = await myWorkIds(env, String(who.email).toLowerCase());
    if (!ids.length) return json({ ok: true, items: [], kinds: KINDS });
  }

  const prefixes = ids ? ids.map(w => 'fb:' + w + ':') : ['fb:'];
  const items = [];
  for (const p of prefixes) {
    let cursor;
    for (let guard = 0; guard < 5; guard++) {
      const l = await kv.list({ prefix: p, cursor, limit: 200 });
      for (const k of l.keys) {
        if (items.length >= 300) break;
        const raw = await kv.get(k.name);
        if (!raw) continue;
        try {
          const r = JSON.parse(raw);
          if (r.status === 'hidden' && !showHidden) continue;
          items.push(r);
        } catch (e) {}
      }
      if (l.list_complete || items.length >= 300) break;
      cursor = l.cursor;
    }
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return json({ ok: true, items, kinds: KINDS, isOwner });
}

/** 印を付ける。{workId, id, status:'new'|'done'|'hidden'} */
export async function onRequestPatch(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'kv_unbound' }, 500);
  const who = await whoAmI(request, env);
  if (!who) return json({ error: 'unauthorized', message: 'ログインが必要です。' }, 401);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const workId = clean(body.workId, 100), id = clean(body.id, 60), status = clean(body.status, 10);
  if (!workId || !id || ['new', 'done', 'hidden'].indexOf(status) < 0) return json({ error: 'bad_request' }, 400);
  if (!hasRole(who, 'owner')) {
    const own = await workOwner(env, workId);
    if (own !== String(who.email).toLowerCase()) return json({ error: 'forbidden', message: 'この作品の作者ではありません。' }, 403);
  }
  const key = 'fb:' + workId + ':' + id;
  const raw = await kv.get(key);
  if (!raw) return json({ error: 'not_found' }, 404);
  const r = JSON.parse(raw);
  r.status = status;
  r.updatedAt = new Date().toISOString();
  await kv.put(key, JSON.stringify(r), { expirationTtl: KEEP_DAYS * 86400 });
  return json({ ok: true, item: r });
}
