// sw.js — AniNovel Service Worker
// ------------------------------------------------------------
// キャッシュ戦略:
//   - HTML / JS / CSS（アプリ本体）  : network-first（常に最新、オフライン時のみキャッシュ）
//   - 画像・フォント・アイコン        : cache-first（gallery/lipsync/icons 等の不変資産）
//   - /api/* と外部オリジン           : 介入しない（常にネットワーク。翻訳API等）
// 更新:
//   - CACHE_VERSION を上げると旧キャッシュを全削除して作り直す（=確実に最新化）
//   - viewer.html から {type:'SKIP_WAITING'} を受け取ると即時有効化 → 自動リロード
// ------------------------------------------------------------

const CACHE_VERSION = 'v24-2026-06-06';      // ← 更新のたびにこの値を上げる
const CACHE_NAME = 'aninovel-' + CACHE_VERSION;

// オフライン用の最小プリキャッシュ（失敗しても install は止めない）
const PRECACHE_URLS = ['./', './viewer.html', './manifest.json'];

// network-first 対象（アプリ本体）
const APP_SHELL_RE = /\.(?:html|js|css|mjs)$/i;
// cache-first 対象（不変資産）
const STATIC_ASSET_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|eot|ico)$/i;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(PRECACHE_URLS.map(u => cache.add(u)))
    )
  );
  // 自動 skipWaiting はしない（明示メッセージ時のみ）。初回以降は viewer.html が要求。
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// viewer.html から即時有効化の要求を受ける
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // POST(/api/translate等)は素通し

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // 外部(Google Fonts/CDN/API)は介入しない
  if (url.pathname.startsWith('/api/')) return;      // 自前APIも常にネットワーク

  // 不変資産は cache-first
  if (STATIC_ASSET_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // アプリ本体・ナビゲーションは network-first
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
      cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = (await cache.match('./viewer.html')) || (await cache.match('./'));
      if (shell) return shell;
    }
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.status === 200) cache.put(req, res.clone());
  return res;
}
