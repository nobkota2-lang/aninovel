/**
 * 管理画面への入口  /api/admin/login
 * --------------------------------------------------
 * 管理画面の「ログインする」ボタンの行き先。
 *
 * 2つの入り方がある。
 *   1. Cloudflare Access … api/admin/* を守っている。Access の
 *      ログインが済むとここに到達するので、そのまま管理画面へ戻す。
 *   2. サイトのログイン … オーナーの役を持つアカウントでログインする。
 *
 * 2026-10-20: ここは ACCESS_TEAM_DOMAIN と ACCESS_AUD が無いと
 * 503「Access が未設定です」を返していた。環境変数が入っていないため、
 * 管理画面で「ログインする」を押すと、ログイン画面ではなくこの文が
 * 出ていた。押した人には何をすればよいか分からない。
 *
 * 判定そのものは _owner.js の whoAmI に任せる（Access でもサイトの
 * ログインでも通る）。ここは行き先を決めるだけにする。
 *   ログイン済みでオーナー → 管理画面へ
 *   ログインしていない     → サイトのログイン画面へ（戻り先を付ける）
 *   ログイン済みだが役が違う → 403。ログイン画面に送っても解決しない。
 */
import { whoAmI, hasRole } from '../../_owner.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  let who = null;
  try { who = await whoAmI(request, env); } catch (e) { who = null; }

  const url = new URL(request.url);
  // 行き先は、このサイトの中だけ。
  //
  // 2026-10-20: ここは /^\/[A-Za-z0-9._\-\/]*$/ で見ていた。
  // この形は "//evil.example" を通してしまう（/ も . も - も許すため）。
  // ブラウザは Location: //evil.example を外部サイトとして辿るので、
  // aninovel.com から任意のサイトへ飛ばせる口になっていた。
  // login.html の dest() と同じ /^\/[^\/]/ を使う。2つ目の文字が / でない、
  // つまり1つの / で始まる道だけを通す。
  const to = url.searchParams.get('to');
  const safe = typeof to === 'string'
    && /^\/[^\/\\]/.test(to)
    && /^\/[A-Za-z0-9._\-\/]*$/.test(to);
  const dest = safe ? to : '/admin-authors.html';

  const go = (location) => new Response(null, {
    status: 302, headers: { Location: location, 'Cache-Control': 'no-store' },
  });

  if (who && hasRole(who, 'owner')) return go(dest);

  if (!who) {
    // login.html は ?back= で戻り先を受ける。
    return go('/login.html?back=' + encodeURIComponent(dest));
  }

  return new Response('この画面はオーナーだけが開けます。', {
    status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
