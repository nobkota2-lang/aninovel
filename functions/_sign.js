/**
 * 署名付きURL  functions/_sign.js
 * --------------------------------------------------
 * 音声の URL に、期限付きの署名を付ける。
 *
 *   /api/audio/<作品ID>/<itemId>?e=<期限ミリ秒>&s=<署名>
 *
 * 署名は HMAC-SHA256(AUDIO_SIGN_KEY, "<作品ID>.<期限>")。
 * 鍵はサーバの環境変数にしか無いので、URL を見ても作れない。
 * 期限を過ぎた URL は拒否するので、盗んで貼っても 30 分で死ぬ。
 *
 * 環境変数 AUDIO_SIGN_KEY が未設定なら署名は発行も検証もしない
 * （従来どおり Referer だけで守る）。鍵を入れた時点で有効になる。
 */

export const SIGN_TTL_MS = 30 * 60 * 1000;   // 30分

function bytes(s) { return new TextEncoder().encode(s); }

function b64url(buf) {
  let bin = '';
  const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', bytes(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** 署名を作る。鍵が無ければ null。 */
export async function signWork(env, workId, ttlMs) {
  const secret = env && env.AUDIO_SIGN_KEY;
  if (!secret) return null;
  const e = Date.now() + (ttlMs || SIGN_TTL_MS);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, bytes(workId + '.' + e));
  return { e: e, s: b64url(sig) };
}

/** 署名が正しくて期限内か。鍵が無ければ検証しない(true)。 */
export async function verifyWork(env, workId, e, s) {
  const secret = env && env.AUDIO_SIGN_KEY;
  if (!secret) return true;                       // 鍵未設定 = 署名を使わない運用
  const exp = parseInt(e, 10);
  if (!exp || !s) return false;
  if (Date.now() > exp) return false;             // 期限切れ
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, bytes(workId + '.' + exp));
  const want = b64url(sig);
  // 長さが違えば即座に不一致。同じなら時間差が出ないように最後まで比べる。
  if (want.length !== String(s).length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ String(s).charCodeAt(i);
  return diff === 0;
}
