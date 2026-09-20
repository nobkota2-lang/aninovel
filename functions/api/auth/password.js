/** パスワードの変更  POST /api/auth/password  { current, next } */
import { kvOf, json, currentWriter, getUser, putUser,
         verifyPassword, hashPassword, passwordProblem } from '../../_authlib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  const me = await currentWriter(request, env);
  if (!me) return json({ error: 'ログインしてください。' }, 401);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: '入力が不正です' }, 400); }

  const u = await getUser(kv, me.email);
  if (!u) return json({ error: 'not_found' }, 404);

  const ok = await verifyPassword(String(b.current || ''), u.pw);
  if (!ok) return json({ error: '現在のパスワードが違います。' }, 401);

  const ng = passwordProblem(b.next);
  if (ng) return json({ error: ng }, 400);

  u.pw = await hashPassword(b.next);
  u.pwChangedAt = Date.now();
  await putUser(kv, u);
  return json({ ok: true });
}
