/**
 * Cloudflare Access の検証ヘルパー
 * 配置: E:\aninovel\aninovel\functions\_access.js
 *
 * Access で保護したパスには Cf-Access-Jwt-Assertion ヘッダが付く。
 * その JWT を Cloudflare の公開鍵で検証し、確かな e-mail を取り出す。
 * ブラウザ側は何も送らないので、利用者が詐称することはできない。
 *
 * 必要な環境変数 (Pages の Settings -> Environment variables):
 *   ACCESS_TEAM_DOMAIN   例) aninovel.cloudflareaccess.com
 *   ACCESS_AUD           Access アプリケーションの Audience Tag
 *   ANINOVEL_OWNER_EMAIL オーナーのメールアドレス (全作品を編集できる)
 *
 * どれかが未設定なら検証は行わず null を返す。
 * 呼び出し側は「null なら従来どおり」にすることで段階的に導入できる。
 */

let _keyCache = { at: 0, keys: null };

async function fetchKeys(teamDomain) {
  const now = Date.now();
  if (_keyCache.keys && now - _keyCache.at < 60 * 60 * 1000) return _keyCache.keys;
  const r = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs ' + r.status);
  const j = await r.json();
  _keyCache = { at: now, keys: j.keys || [] };
  return _keyCache.keys;
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @returns {Promise<{email:string, isOwner:boolean}|null>}
 *   null = Access が未設定、またはトークンが無い/不正
 */
export async function verifyAccess(request, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!teamDomain || !aud) return null;            // 未設定 = 段階導入中

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch (e) { return null; }

  // aud と有効期限
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && nowSec > payload.exp) return null;
  if (payload.nbf && nowSec < payload.nbf - 60) return null;
  if (payload.iss && payload.iss !== `https://${teamDomain}`) return null;

  // 署名の検証
  let keys;
  try { keys = await fetchKeys(teamDomain); } catch (e) { return null; }
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return null;

  let ok = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1])
    );
  } catch (e) { return null; }
  if (!ok) return null;

  const email = (payload.email || '').toLowerCase();
  if (!email) return null;
  const owner = (env.ANINOVEL_OWNER_EMAIL || '').toLowerCase();
  return { email, isOwner: !!owner && email === owner };
}
