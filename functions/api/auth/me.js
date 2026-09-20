/** いまログインしている作者  GET /api/auth/me */
import { json, currentWriter } from '../../_authlib.js';

export async function onRequestGet(context) {
  const me = await currentWriter(context.request, context.env);
  if (!me) return json({ loggedIn: false });
  return json({ loggedIn: true, email: me.email, nickname: me.nickname });
}
