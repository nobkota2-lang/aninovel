/**
 * どこから来た要求かを見る  functions/_origin.js
 * --------------------------------------------------
 * 公開サイトの HTML と JS は誰でも複製できる。止められない。
 * 守れるのは「中身」— 作品の本文・音声・翻訳を返すAPIだけ。
 * ここでは、他所のページから当サイトのAPIを読ませる形の複製を断る。
 *
 * 判定の材料は2つ。
 *   Sec-Fetch-Site … ブラウザが必ず付ける。自サイトからなら same-origin。
 *                    海賊サイトのページから読むと cross-site になる。
 *                    利用者側では書き換えられない。
 *   Referer/Origin … 従来からの手掛かり。消せるので補助。
 *
 * どちらも無い要求（curl など）は通す。プライバシー設定でこれらを
 * 送らない読者が実在するため、ここで拒むと正規の読者が読めなくなる。
 * つまり完全な封鎖ではない。「他所のページに貼るだけ」を止め、
 * 相手に自前で再ホストする手間と費用を負わせるための措置。
 */

const ALLOWED_HOSTS = [
  'aninovel.com',
  'aninovel.pages.dev',
  'localhost',
  '127.0.0.1',
];

function hostAllowed(value) {
  if (!value) return null;                 // 判定材料なし
  let host;
  try { host = new URL(value).hostname.toLowerCase(); } catch (e) { return null; }
  return ALLOWED_HOSTS.some((a) => host === a || host.endsWith('.' + a));
}

/** 自サイトからの要求とみなせるか */
export function sameSite(request) {
  const sfs = (request.headers.get('Sec-Fetch-Site') || '').toLowerCase();
  if (sfs === 'cross-site') return false;              // 他所のページからの読み込み
  if (sfs === 'same-origin' || sfs === 'none') return true;

  const ref = hostAllowed(request.headers.get('Origin') || request.headers.get('Referer'));
  if (ref === false) return false;
  return true;                                          // 手掛かりが無ければ通す
}

export function denyHotlink(what) {
  return new Response(JSON.stringify({
    error: 'hotlink_denied',
    message: (what || 'この内容') + 'は aninovel.com でのみ読めます。',
  }), { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
