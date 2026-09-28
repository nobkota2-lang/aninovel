// sw.js — AniNovel Service Worker
// ------------------------------------------------------------
// キャッシュ方針:
//   - HTML / JS / CSS（アプリ本体） : network-first（常に最新。オフライン時だけキャッシュ）
//   - 画像・フォント・アイコン       : cache-first（gallery / lipsync / icons など不変の資産）
//   - /api/*                        : 何もしない（常にネットワーク。古い作品を掴ませない）
//
// 運用:
//   - CACHE_VERSION を上げると、古いキャッシュを全部消して作り直す
//   - viewer.html から {type:'SKIP_WAITING'} を受け取ると即時有効化する
//
// ※ 以前このファイルは文字コード変換で改行が失われ、
//    「// コメント」が次の行の const 宣言を飲み込んでいた。
//    そのため STATIC_ASSET_RE などが未定義になり、
//    Service Worker が動いていなかった（2026-09-27 修正）。
//    コメントは必ず独立した行に置くこと。
// ------------------------------------------------------------

const CACHE_VERSION = 'v26-2026-09-27';
const CACHE_NAME = 'aninovel-' + CACHE_VERSION;

// オフライン用の最小限のプリキャッシュ（失敗しても install は止めない）
const PRECACHE_URLS = ['./', './viewer.html', './manifest.json'];

// network-first の対象（アプリ本体）
const APP_SHELL_RE = /\.(?:html|js|css|mjs)$/i;

// cache-first の対象（不変の資産）
const STATIC_ASSET_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|eot|ico)$/i;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(PRECACHE_URLS.map(u => cache.add(u)))
    )
  );
  // 自動 skipWaiting はしない（明示メッセージ時のみ）。viewer.html が要求する。
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// viewer.html からの即時有効化の要求を受ける
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // POST(/api/translate など)は素通し
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 外部(Google Fonts / CDN / API)は扱わない
  if (url.origin !== self.location.origin) return;
  // 自前の API も常にネットワーク
  if (url.pathname.startsWith('/api/')) return;

  // 不変の資産は cache-first
  if (STATIC_ASSET_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // アプリ本体とナビゲーションは network-first
  if (APP_SHELL_RE.test(url.pathname) || req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

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
