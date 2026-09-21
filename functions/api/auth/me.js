/** いまログインしている利用者  GET /api/auth/me */
import { json, currentUser } from '../../_authlib.js';

export async function onRequestGet(context) {
  const me = await currentUser(context.request, context.env);
  if (!me) return json({ loggedIn: false });
  return json({ loggedIn: true, email: me.email, nickname: me.nickname,
                roles: me.roles, isAuthor: me.isAuthor });
}
