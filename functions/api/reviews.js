/**
 * 作品の評価と口コミ  /api/reviews
 * ============================================================
 *   GET    ?workId=   … 誰でも読める。平均の★・件数・内訳と、口コミの一覧
 *   POST              … ログイン中の読者が ★1〜5 と短い口コミを付ける
 *                       (1人1作品につき1件。もう一度送ると書き換え)
 *   DELETE ?workId=   … 自分の口コミを取り下げる
 *   PATCH             … オーナーが口コミを非表示/再表示にする
 *
 * なぜスレッドにしないのか
 *   返信の付く掲示板は、口コミへの反論や読者同士の言い合いが起きやすい。
 *   ここは「1人1件の単純投稿」に限り、返信の仕組みを持たない。
 *   作者の反論欄も設けない(作者は作品で応える)。
 *
 * なぜログインを必須にするのか
 *   ★は人気の指標として使うので、同じ人が何度も付けて操作できては困る。
 *   また、口コミには名前(ニックネーム)が出るので、書いた人が分かる方が荒れにくい。
 *   作者が自分の作品に付けることはできない。
 *
 * KV のキー
 *   rv:<作品ID>:<メールのハッシュ>  … 1件
 *   rvsum:<作品ID>                  … 集計 {n, sum, avg, dist[1..5], at}
 */

import { kvOf, currentUser, normEmail } from '../_authlib.js';
import { whoAmI, hasRole } from '../_owner.js';
import { db } from '../_d1.js';

const MAX_TEXT = 400;
const LIST_MAX = 50;

function json(obj, status = 200, cache) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache || 'no-store' },
  });
}
function clean(s, n) {
  return String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, n);
}
function looksLikeSpam(t) {
  return /https?:\/\/|www\.|\.com\b|\.net\b|\.jp\b/i.test(t) || /(.)\1{14,}/.test(t);
}
async function emailMark(email) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('aninovel-review|' + normEmail(email)));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
async function workOwner(env, workId) {
  const d = db(env);
  if (!d) return null;
  try {
    const r = await d.prepare('SELECT owner_email FROM works_meta WHERE work_id = ?1').bind(workId).first();
    return (r && r.owner_email) ? String(r.owner_email).toLowerCase() : null;
  } catch (e) { return null; }
}

async function listAll(kv, workId) {
  const out = [];
  let cursor;
  for (let guard = 0; guard < 10; guard++) {
    const l = await kv.list({ prefix: 'rv:' + workId + ':', cursor, limit: 1000 });
    for (const k of l.keys) {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try { out.push(JSON.parse(raw)); } catch (e) {}
    }
    if (l.list_complete) break;
    cursor = l.cursor;
  }
  return out;
}

// 集計は毎回数え直す(同時に書かれても数がずれない)。非表示のものは数えない。
async function resum(kv, workId) {
  const all = await listAll(kv, workId);
  const dist = [0, 0, 0, 0, 0, 0];
  let n = 0, sum = 0;
  for (const r of all) {
    if (r.hidden) continue;
    const s = Math.max(1, Math.min(5, r.stars | 0));
    dist[s]++; n++; sum += s;
  }
  const sm = { n, sum, avg: n ? Math.round((sum / n) * 10) / 10 : 0, dist: dist.slice(1), at: new Date().toISOString() };
  await kv.put('rvsum:' + workId, JSON.stringify(sm));
  return { sm, all };
}

function publicRow(r) {
  return { stars: r.stars, text: r.text, nick: r.nick, lang: r.lang, at: r.at, edited: !!r.edited, rid: r.rid };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'kv_unbound' }, 500);
  const url = new URL(request.url);
  const workId = clean(url.searchParams.get('workId'), 100);

  // 一覧カード用: ?summary=id1,id2,...  集計だけを返す
  const many = clean(url.searchParams.get('summary'), 3000);
  if (many) {
    const ids = many.split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
    const out = {};
    for (const id of ids) {
      const raw = await kv.get('rvsum:' + id);
      if (raw) { try { const s = JSON.parse(raw); if (s.n) out[id] = { n: s.n, avg: s.avg }; } catch (e) {} }
    }
    return json({ ok: true, summary: out }, 200, 'public, max-age=120');
  }
  if (!workId) return json({ error: 'bad_work' }, 400);

  const all = await listAll(kv, workId);
  const sumRaw = await kv.get('rvsum:' + workId);
  let sm = null;
  try { sm = sumRaw ? JSON.parse(sumRaw) : null; } catch (e) {}
  if (!sm) sm = (await resum(kv, workId)).sm;

  let mine = null, isOwner = false;
  const user = await currentUser(request, env).catch(() => null);
  if (user) {
    const m = await emailMark(user.email);
    const r = all.find(x => x.mark === m);
    if (r) mine = { stars: r.stars, text: r.text, hidden: !!r.hidden };
    isOwner = (user.roles || []).indexOf('owner') !== -1;
  }
  const visible = all.filter(r => !r.hidden || isOwner)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, LIST_MAX)
    .map(r => Object.assign(publicRow(r), isOwner ? { hidden: !!r.hidden } : {}));
  return json({ ok: true, summary: sm, reviews: visible, mine, loggedIn: !!user, isOwner });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'kv_unbound' }, 500);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return json({ error: 'login_required', message: '評価・口コミの投稿には読者登録(無料)とログインが必要です。' }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const workId = clean(body.workId, 100);
  const stars = body.stars | 0;
  const text = clean(body.text, MAX_TEXT);
  const lang = body.lang === 'en' ? 'en' : 'ja';
  if (!workId) return json({ error: 'bad_work', message: '対象の作品が分かりません。' }, 400);
  if (stars < 1 || stars > 5) return json({ error: 'bad_stars', message: '★を1〜5で選んでください。' }, 400);
  if (looksLikeSpam(text)) return json({ error: 'spam', message: 'URLを含む投稿や、同じ文字の繰り返しは受け付けていません。' }, 400);

  const owner = await workOwner(env, workId);
  if (owner && owner === normEmail(user.email)) {
    return json({ error: 'own_work', message: 'ご自分の作品には評価を付けられません。' }, 403);
  }

  const mark = await emailMark(user.email);
  const key = 'rv:' + workId + ':' + mark;
  const prevRaw = await kv.get(key);
  let prev = null;
  try { prev = prevRaw ? JSON.parse(prevRaw) : null; } catch (e) {}
  const now = new Date().toISOString();
  const rec = {
    rid: mark.slice(0, 10), mark, workId, stars, text, lang,
    nick: clean(user.nickname, 40) || (lang === 'en' ? 'Reader' : '読者'),
    at: prev ? prev.at : now,
    updatedAt: now,
    edited: !!prev,
    hidden: prev ? !!prev.hidden : false,   // 運営が非表示にしたものは、書き直しても非表示のまま
  };
  await kv.put(key, JSON.stringify(rec));
  const { sm } = await resum(kv, workId);
  return json({ ok: true, summary: sm, message: prev ? '口コミを更新しました。' : '投稿しました。ありがとうございます。' });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'kv_unbound' }, 500);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return json({ error: 'login_required' }, 401);
  const workId = clean(new URL(request.url).searchParams.get('workId'), 100);
  if (!workId) return json({ error: 'bad_work' }, 400);
  await kv.delete('rv:' + workId + ':' + (await emailMark(user.email)));
  const { sm } = await resum(kv, workId);
  return json({ ok: true, summary: sm, message: '取り下げました。' });
}

/** オーナーが非表示/再表示にする。{workId, rid, hidden:true|false} */
export async function onRequestPatch(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'kv_unbound' }, 500);
  const who = await whoAmI(request, env);
  if (!who || !hasRole(who, 'owner')) return json({ error: 'forbidden', message: 'オーナーだけが操作できます。' }, 403);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const workId = clean(body.workId, 100), rid = clean(body.rid, 20);
  if (!workId || !rid) return json({ error: 'bad_request' }, 400);
  const all = await listAll(kv, workId);
  const r = all.find(x => x.rid === rid);
  if (!r) return json({ error: 'not_found' }, 404);
  r.hidden = !!body.hidden;
  await kv.put('rv:' + workId + ':' + r.mark, JSON.stringify(r));
  const { sm } = await resum(kv, workId);
  return json({ ok: true, summary: sm });
}
