/**
 * アニノベル Cloudflare Pages Functions ミドルウェア
 * 配置: /functions/_middleware.js
 *
 * すべての /api/* リクエストに自動適用される。
 * 機能:
 *   - CORS (本サイトからのみ許可)
 *   - レート制限 (IP毎、KVベース、簡易版)
 *   - リクエストロギング (Cloudflare 標準ログで十分なら省略可)
 */

// 本サイト以外からのfetchをブロックする (CSRF対策の一部)
const ALLOWED_ORIGINS = [
  'https://aninovel.com',
  'https://www.aninovel.com',
  'https://aninovel.pages.dev',
  'http://localhost:8765',
  'http://localhost:8788', // wrangler dev
];

const RATE_LIMIT = {
  '/api/newsletter': { max: 5, windowSec: 600 },   // 10分5回まで
  '/api/reports': { max: 10, windowSec: 600 },     // 10分10回まで
  '/api/errors': { max: 50, windowSec: 600 },      // 10分50回まで
  '/api/billing': { max: 20, windowSec: 600 },     // 課金フロー
  // 音声は1ブロック1ファイル。読者は5秒に1件ほどしか要らない (約12回/分)。
  // 40回/分なら読者に3倍の余裕がありつつ、全作品(約7,600件)の一括取得には
  // 1IPあたり3時間以上かかる。ただし複数IPを使う相手には効かない。
  // 本命はホットリンク防止のほうで、これは補助。
  '/api/audio': { max: 40, windowSec: 60 },
  default: { max: 60, windowSec: 60 },             // 1分60回
};

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // ===== /api/* 以外は素通し =====
  if (!url.pathname.startsWith('/api/')) {
    return next();
  }

  // ===== CORSプリフライト =====
  if (request.method === 'OPTIONS') {
    return corsPreflight(request);
  }

  // ===== Origin検証 (CSRF対策) =====
  const origin = request.headers.get('Origin');
  const allowed = !origin || ALLOWED_ORIGINS.some(a => origin === a);
  if (!allowed) {
    return json({ error: 'forbidden_origin', message: '許可されていないオリジンからのリクエストです' }, 403);
  }

  // ===== レート制限 (KVが設定されている場合のみ) =====
  if (env.RATE_LIMIT_KV) {
    const limit = pickLimit(url.pathname);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = `rl:${url.pathname}:${ip}:${Math.floor(Date.now() / 1000 / limit.windowSec)}`;
    try {
      const cur = parseInt(await env.RATE_LIMIT_KV.get(key) || '0', 10);
      if (cur >= limit.max) {
        return json({
          error: 'rate_limited',
          message: 'リクエストが多すぎます。しばらくしてから再度お試しください。',
          retryAfter: limit.windowSec
        }, 429, { 'Retry-After': String(limit.windowSec) });
      }
      // 加算 (TTL=window)
      await env.RATE_LIMIT_KV.put(key, String(cur + 1), { expirationTtl: limit.windowSec + 60 });
    } catch (e) {
      console.warn('[middleware] rate limit error:', e);
      // KVエラーでもリクエストは通す (フェイルオープン)
    }
  }

  // ===== 後段のFunctionsへ =====
  const response = await next();

  // ===== CORSレスポンスヘッダ付与 =====
  const newHeaders = new Headers(response.headers);
  if (origin) {
    newHeaders.set('Access-Control-Allow-Origin', origin);
    newHeaders.set('Vary', 'Origin');
  }
  newHeaders.set('Access-Control-Allow-Credentials', 'true');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function corsPreflight(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin);
  if (!allowed) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Aninovel-Build',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    }
  });
}

function pickLimit(pathname) {
  for (const [prefix, lim] of Object.entries(RATE_LIMIT)) {
    if (prefix !== 'default' && pathname.startsWith(prefix)) return lim;
  }
  return RATE_LIMIT.default;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    }
  });
}
