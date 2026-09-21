/** メールアドレスの確認  POST /api/auth/verify  { token } */
import { kvOf, json, takeVerify, getUser, putUser } from '../../_authlib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: '入力が不正です' }, 400); }

  const rec = await takeVerify(kv, String(b.token || ''));
  if (!rec) return json({ error: 'このリンクは使えません。期限切れか、既に使用済みです。' }, 400);

  const u = await getUser(kv, rec.email);
  if (!u) return json({ error: 'not_found' }, 404);
  if (u.status !== 'active') {
    u.status = 'active';
    u.verifiedAt = Date.now();
    await putUser(kv, u);
  }
  return json({ ok: true, message: '確認が完了しました。ログインしてください。' });
}
