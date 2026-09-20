/** 新しいパスワードを設定  POST /api/auth/reset  { token, password } */
import { kvOf, json, takeReset, getUser, putUser, hashPassword, passwordProblem } from '../../_authlib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: '入力が不正です' }, 400); }

  const ng = passwordProblem(b.password);
  if (ng) return json({ error: ng }, 400);

  const rec = await takeReset(kv, String(b.token || ''));
  if (!rec) return json({ error: 'このリンクは使えません。期限切れか、既に使用済みです。' }, 400);

  const u = await getUser(kv, rec.email);
  if (!u) return json({ error: 'not_found' }, 404);

  u.pw = await hashPassword(b.password);
  u.pwChangedAt = Date.now();
  await putUser(kv, u);
  return json({ ok: true, message: 'パスワードを変更しました。ログインしてください。' });
}
