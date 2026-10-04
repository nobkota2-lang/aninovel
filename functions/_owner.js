/**
 * だれが何をしてよいか、ここ1か所で決める  functions/_owner.js
 * --------------------------------------------------
 * これまで「オーナー」の定義が2つに分かれていた。
 *   ・Cloudflare Access の ANINOVEL_OWNER_EMAIL（環境変数）
 *   ・サイトのアカウントの roles:['owner']（KV の user:<email>）
 * 片方だけ変えると食い違うので、**利用者の記録(roles)を唯一の正**とする。
 * 環境変数は、利用者の記録がまだ無い最初の1回だけの引き当てに使う。
 *
 * 入口は2つあってよい（Access の使い捨て番号 / サイトのログイン）。
 * どちらから来ても、最後は同じ roles を見る。
 */
import { verifyAccess } from './_access.js';
import { kvOf, getUser, currentUser, isActive } from './_authlib.js';

export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export function hasRole(who, role) {
  return !!who && Array.isArray(who.roles) && who.roles.indexOf(role) !== -1;
}

/**
 * いま操作している人を1つに決める。
 * @returns {Promise<{email:string, roles:string[], via:string}|null>}
 */
export async function whoAmI(request, env) {
  // 1) サイトのログイン（セッションクッキー）
  try {
    const su = await currentUser(request, env);
    // nickname は「画面に出す作者名」の初期値に使う。権限とは無関係。
    if (su) return { email: su.email, nickname: su.nickname || '', roles: (su.roles || ['reader']).slice(), via: 'session' };
  } catch (e) {}

  // 2) Cloudflare Access（管理画面の入口）
  let acc = null;
  try { acc = await verifyAccess(request, env); } catch (e) { acc = null; }
  if (acc && acc.email) {
    const kv = kvOf(env);
    let u = null;
    try { u = kv ? await getUser(kv, acc.email) : null; } catch (e) {}
    if (isActive(u)) return { email: u.email, nickname: u.nickname || '', roles: (u.roles || ['reader']).slice(), via: 'access' };
    // 利用者の記録がまだ無い＝立ち上げ直後。環境変数の指定でだけ通す。
    if (acc.isOwner) return { email: acc.email, roles: ['reader', 'author', 'owner'], via: 'access-bootstrap' };
    return { email: acc.email, roles: ['reader'], via: 'access' };
  }
  return null;
}

function denyUnauth(env) {
  // ログインしていないのだから、返すのは 401 ひとつでよい。
  //
  // 以前は Access の環境変数が無いときに 503「Access が未設定です」を
  // 返していた。しかし Access で守られたパスには、未ログインの要求は
  // そもそも届かない（Cloudflare が手前で止める）。つまりこの分岐が
  // 働くのは守られていないパス、すなわち /api/points のように
  // 「サイトのログインで判断する」口だけで、そこを開いた作者には
  // 意味の分からない 503 が返っていた。画面側も 401 を見て
  // 「ログインしてください」を出す作りなので、案内が出なかった。
  //
  // 運営者向けの情報は本文に添えるだけにして、状態は 401 に統一する。
  const accessOn = !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
  return json({
    error: 'unauthorized',
    message: 'ログインが必要です。',
    accessConfigured: accessOn,
  }, 401);
}

/** オーナーだけ。 */
export async function requireOwner(context) {
  const who = await whoAmI(context.request, context.env);
  if (!who) return { deny: denyUnauth(context.env) };
  if (!hasRole(who, 'owner')) {
    return { deny: json({ error: 'forbidden', message: 'オーナーだけが操作できます。' }, 403) };
  }
  return { who };
}

/** 作者かオーナー。作品や音声・翻訳の書き込みに使う。 */
export async function requireWriter(context) {
  const who = await whoAmI(context.request, context.env);
  if (!who) return { deny: denyUnauth(context.env) };
  if (!hasRole(who, 'author') && !hasRole(who, 'owner')) {
    return { deny: json({ error: 'forbidden', message: '作者かオーナーのアカウントが必要です。' }, 403) };
  }
  return { who };
}
