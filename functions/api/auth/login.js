/** 作者のログイン  POST /api/auth/login   { email, password } */
import { kvOf, json, normEmail, getUser, verifyPassword,
         createSession, sessionCookie } from '../../_authlib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: '入力が不正です' }, 400); }
  const email = normEmail(b.email);
  const password = b.password;

  const u = await getUser(kv, email);
  // 「どちらが違うか」を教えない。総当たりの手がかりを与えないため。
  const ng = () => json({ error: 'メールアドレスかパスワードが違います。' }, 401);
  if (!u) { await verifyPassword(String(password || ''), { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', hash: 'x' }); return ng(); }
  if (u.status !== 'approved') {
    return json({ error: 'このアカウントはまだ承認されていません。' }, 403);
  }
  const ok = await verifyPassword(String(password || ''), u.pw);
  if (!ok) return ng();

  const s = await createSession(kv, u.email);
  return json({ ok: true, nickname: u.nickname, email: u.email },
    200, { 'Set-Cookie': sessionCookie(s.token, s.ttl) });
}
