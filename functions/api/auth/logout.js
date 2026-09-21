/** ログアウト  POST /api/auth/logout */
import { kvOf, json, currentUser, destroySession, clearCookie } from '../../_authlib.js';

export async function onRequestPost(context) {
  const kv = kvOf(context.env);
  const me = await currentUser(context.request, context.env);
  if (kv && me) await destroySession(kv, me.token);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}
