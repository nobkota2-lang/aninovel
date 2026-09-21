/**
 * 作者アカウントの土台  functions/_authlib.js
 * --------------------------------------------------
 * ・パスワードは PBKDF2-SHA256 で伸長して保存する。平文は持たない。
 * ・ログインするとランダムなセッショントークンを発行し、KV に置く。
 *   クッキーは HttpOnly / Secure / SameSite=Lax。
 * ・KV のキー
 *     user:<email>            … 作者の本体
 *     apply:<id>              … 申請
 *     sess:<token>            … セッション
 *     reset:<token>           … パスワード再設定
 *
 * オーナーの承認画面は Cloudflare Access のままで、ここは通らない。
 */

// PBKDF2 の回数。OWASP は 21 万回を推奨するが、
// Cloudflare Workers の無料プランは 1 リクエスト 10ms の CPU 時間しかなく、
// 21 万回だと超えて Worker が落ちる(500 になる)。
// そこで 1 万回に下げる。PBKDF2 としては弱くなるが、
//   ・パスワードは 10 文字以上を強制
//   ・ハッシュは KV にしかなく、漏れる経路が限られる
// この 2 つと合わせて実用上は許容できると判断した。
// Workers Paid($5/月)にすれば CPU は 30 秒まで使えるので、
// そのときはこの値を 210000 に戻すとよい。
// (既存のパスワードは rec.iter を見るので、値を変えてもログインできる)
const PBKDF2_ITER = 10000;
const SESSION_DAYS = 30;
const RESET_HOURS = 2;

export function kvOf(env) { return env.WORKS || env.WORKS_KV || null; }

export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function b64(bytes) {
  let s = '';
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randToken(n = 32) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, saltB64, iter) {
  const n = iter || PBKDF2_ITER;
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: n, hash: 'SHA-256' }, key, 256
  );
  return { salt: b64(salt), hash: b64(bits), iter: n };
}

export async function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  // 保存されたときの回数で照合する。
  // PBKDF2_ITER を後から変えても、古いパスワードでログインできる。
  const got = await hashPassword(password, rec.salt, rec.iter);
  // 長さが同じ前提で、時間差の出ない比較をする
  const a = got.hash, b = rec.hash;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function normEmail(s) {
  return String(s || '').trim().toLowerCase();
}
export function validEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
}
/** 弱すぎるパスワードを断る。理由を返す（問題なければ null）。 */
export function passwordProblem(pw) {
  if (typeof pw !== 'string') return 'パスワードを入力してください。';
  if (pw.length < 10) return 'パスワードは10文字以上にしてください。';
  if (pw.length > 200) return 'パスワードが長すぎます。';
  if (/^[0-9]+$/.test(pw)) return '数字だけのパスワードは使えません。';
  const weak = ['password', '12345678', 'aninovel', 'qwertyui'];
  const low = pw.toLowerCase();
  if (weak.some(w => low.includes(w))) return '推測されやすいパスワードです。';
  return null;
}

// ---- セッション ----

export async function createSession(kv, email) {
  const token = randToken(32);
  const ttl = SESSION_DAYS * 24 * 60 * 60;
  await kv.put('sess:' + token, JSON.stringify({ email, at: Date.now() }), { expirationTtl: ttl });
  return { token, ttl };
}

export function sessionCookie(token, ttl) {
  return `an_sess=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;
}
export function clearCookie() {
  return 'an_sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

function cookieValue(request, name) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? m[1] : null;
}

/**
 * アカウントの状態と役割
 *   status : 'unverified'(メール未確認) | 'active'
 *   roles  : ['reader'] か ['reader','author']
 * 古い記録(status:'approved' で roles が無いもの)は作者として扱う。
 */
export function normalizeUser(u) {
  if (!u) return u;
  if (!Array.isArray(u.roles)) {
    u.roles = (u.status === 'approved') ? ['reader', 'author'] : ['reader'];
  }
  if (u.status === 'approved') u.status = 'active';
  return u;
}
export function isActive(u) { return !!u && normalizeUser(u).status === 'active'; }
export function isAuthor(u) { return isActive(u) && u.roles.indexOf('author') !== -1; }

/** ログイン中の利用者(読者も作者も)。未ログインなら null。 */
export async function currentUser(request, env) {
  const kv = kvOf(env);
  if (!kv) return null;
  const token = cookieValue(request, 'an_sess');
  if (!token) return null;
  const raw = await kv.get('sess:' + token);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch (e) { return null; }
  if (!s || !s.email) return null;
  const u = await getUser(kv, s.email);
  if (!isActive(u)) return null;
  return { email: u.email, nickname: u.nickname, roles: u.roles.slice(),
           isAuthor: isAuthor(u), token };
}

/** ログイン中の作者だけを返す。読者や未ログインなら null。 */
export async function currentWriter(request, env) {
  const me = await currentUser(request, env);
  return (me && me.isAuthor) ? me : null;
}

export async function destroySession(kv, token) {
  if (token) await kv.delete('sess:' + token);
}

// ---- 作者の記録 ----

export async function getUser(kv, email) {
  const raw = await kv.get('user:' + normEmail(email));
  if (!raw) return null;
  try { return normalizeUser(JSON.parse(raw)); } catch (e) { return null; }
}
export async function putUser(kv, user) {
  user.email = normEmail(user.email);
  await kv.put('user:' + user.email, JSON.stringify(user));
  return user;
}

/** 公開してよい項目だけを取り出す */
export function publicProfile(u) {
  if (!u) return null;
  return { nickname: u.nickname || '', bio: u.bio || '', since: u.approvedAt || null };
}

// ---- パスワード再設定 ----

export async function createReset(kv, email) {
  const token = randToken(32);
  await kv.put('reset:' + token, JSON.stringify({ email: normEmail(email), at: Date.now() }),
    { expirationTtl: RESET_HOURS * 60 * 60 });
  return token;
}
export async function takeReset(kv, token) {
  const raw = await kv.get('reset:' + token);
  if (!raw) return null;
  await kv.delete('reset:' + token);   // 一度きり
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export const RESET_VALID_HOURS = RESET_HOURS;

// ---- メール確認(読者登録) ----
const VERIFY_HOURS = 48;
export const VERIFY_VALID_HOURS = VERIFY_HOURS;
export async function createVerify(kv, email) {
  const token = randToken(32);
  await kv.put('verify:' + token, JSON.stringify({ email: normEmail(email), at: Date.now() }),
    { expirationTtl: VERIFY_HOURS * 60 * 60 });
  return token;
}
export async function takeVerify(kv, token) {
  const raw = await kv.get('verify:' + token);
  if (!raw) return null;
  await kv.delete('verify:' + token);
  try { return JSON.parse(raw); } catch (e) { return null; }
}
