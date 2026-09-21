/** ログイン(読者も作者も)  POST /api/auth/login   { email, password } */
import { kvOf, json, normEmail, getUser, verifyPassword, isAuthor,
         createSession, sessionCookie } from '../../_authlib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: '入力が不正です' }, 400); }
  const email = normEmail(b.email);
  const password = String(b.password || '');

  const u = await getUser(kv, email);
  // どちらが違うかは教えない。存在しないときも同じだけ時間をかける。
  const ng = () => json({ error: 'メールアドレスかパスワードが違います。' }, 401);
  if (!u) { await verifyPassword(password, { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', hash: 'x', iter: 10000 }); return ng(); }

  const ok = await verifyPassword(password, u.pw);
  if (!ok) return ng();

  if (u.status === 'unverified') {
    return json({ error: 'メールアドレスの確認が済んでいません。届いたメールのリンクを開いてください。',
                  code: 'unverified' }, 403);
  }
  if (u.status !== 'active') {
    return json({ error: 'このアカウントは現在使えません。' }, 403);
  }

  const s = await createSession(kv, u.email);
  return json({ ok: true, nickname: u.nickname, email: u.email,
                roles: u.roles, isAuthor: isAuthor(u) },
    200, { 'Set-Cookie': sessionCookie(s.token, s.ttl) });
}
