/**
 * 管理画面への入口  /api/admin/login
 * --------------------------------------------------
 * このパスも Cloudflare Access(api/admin/*)で守られている。
 * Access のログインが済むとここに到達するので、そのまま管理画面へ戻す。
 * こうしないと、ログイン後に JSON の画面で止まってしまう。
 */
import { whoAmI, hasRole } from '../../_owner.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  let who = null;
  try { who = await whoAmI(request, env); } catch (e) { who = null; }

  const url = new URL(request.url);
  const to = url.searchParams.get('to');
  const dest = (to && /^\/[A-Za-z0-9._\-\/]*$/.test(to)) ? to : '/admin-authors.html';

  // Access を通っていない場合、ここには来ない(Access のログイン画面が出る)。
  // 念のため、通っていなければ 401 を返す。
  if (!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD)) {
    return new Response('Access が未設定です。', { status: 503 });
  }
  if (!who || !hasRole(who, 'owner')) return new Response('ログインが必要です。', { status: 401 });

  return new Response(null, { status: 302, headers: { Location: dest, 'Cache-Control': 'no-store' } });
}
