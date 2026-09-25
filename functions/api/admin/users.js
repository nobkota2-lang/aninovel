/**
 * 利用者と権限の管理  /api/admin/users
 * --------------------------------------------------
 * オーナーだけ。Cloudflare Access で保護する（Path: api/admin/*）。
 *
 *   GET                  … 利用者の一覧
 *   GET ?email=...       … 1人の内容
 *   PUT { email, nickname?, name?, roles?, status?, password? }
 *                        … 無ければ作る。あれば渡した項目だけ書き換える。
 *
 * パスワードはここでも平文を保存しない(PBKDF2)。
 * メールが届かない環境でもオーナーが手当てできるように、
 * パスワードの設定と有効化(status=active)をこの画面から行えるようにしている。
 */
import { requireOwner } from '../../_owner.js';
import { kvOf, json, normEmail, validEmail, passwordProblem,
         hashPassword, getUser, putUser } from '../../_authlib.js';

const ROLES = ['reader', 'author', 'owner'];
const STATUS = ['active', 'unverified', 'disabled'];

/** 外に出してよい項目だけ（パスワードのハッシュは決して返さない） */
function safe(u) {
  if (!u) return null;
  return {
    email: u.email, nickname: u.nickname || '', name: u.name || '',
    status: u.status || 'unverified', roles: Array.isArray(u.roles) ? u.roles : ['reader'],
    hasPassword: !!(u.pw && u.pw.hash),
    createdAt: u.createdAt || null,
  };
}

export async function onRequestGet(context) {
  const g = await requireOwner(context);
  if (g.deny) return g.deny;
  const kv = kvOf(context.env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  const url = new URL(context.request.url);
  const one = url.searchParams.get('email');
  if (one) {
    const u = await getUser(kv, one);
    if (!u) return json({ error: 'not_found', email: normEmail(one) }, 404);
    return json({ user: safe(u) });
  }

  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: 'user:', cursor });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try { out.push(safe(JSON.parse(raw))); } catch (e) {}
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ users: out });
}

export async function onRequestPut(context) {
  const g = await requireOwner(context);
  if (g.deny) return g.deny;
  const kv = kvOf(context.env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  let b;
  try { b = await context.request.json(); }
  catch (e) { return json({ error: '入力の形式が不正です' }, 400); }

  const email = normEmail(b.email);
  if (!validEmail(email)) return json({ error: 'メールアドレスの形式が正しくありません。' }, 400);

  let u = await getUser(kv, email);
  const creating = !u;
  if (creating) u = { email, name: '', nickname: '', bio: '', status: 'unverified',
                      roles: ['reader'], createdAt: Date.now() };

  if (b.nickname !== undefined) u.nickname = String(b.nickname).trim().slice(0, 50);
  if (b.name !== undefined) u.name = String(b.name).trim().slice(0, 100);

  if (b.roles !== undefined) {
    if (!Array.isArray(b.roles)) return json({ error: 'roles は配列で渡してください。' }, 400);
    const r = b.roles.map(String).filter((x) => ROLES.indexOf(x) !== -1);
    if (r.indexOf('reader') === -1) r.unshift('reader');   // 読者は全員が持つ
    u.roles = r;
  }

  if (b.status !== undefined) {
    const s = String(b.status);
    if (STATUS.indexOf(s) === -1) return json({ error: 'status が不正です。' }, 400);
    u.status = s;
  }

  if (b.password) {
    const ng = passwordProblem(b.password);
    if (ng) return json({ error: ng }, 400);
    u.pw = await hashPassword(b.password);
    u.pwChangedAt = Date.now();
  }

  if (creating && !u.nickname) return json({ error: 'ニックネームを入れてください。' }, 400);
  if (creating && !u.pw) return json({ error: '新しく作るときはパスワードが要ります。' }, 400);

  await putUser(kv, u);
  return json({ ok: true, created: creating, user: safe(u) });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
