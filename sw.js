/* アニノベル Service Worker
 * 戦略:
 *   - HTML / CSS / JS:  network-first  (常に最新を取得、オフライン時のみキャッシュ)
 *   - 画像・フォント(svg/png/woff等): stale-while-revalidate
 *   - 音声(wav 等):     cache-first    (一度取得したら長期キャッシュ)
 *   - data/catalog.json 等の重要JSON: network-first (作品追加を素早く反映)
 *
 * !! 重要 !!
 *   コード(HTML/CSS/JS)を network-first にしたため、デプロイは即座に全端末へ反映される。
 *   万一に備え、デプロイのたびに CACHE_VERSION も変更すること
 *   (変更すると activate で旧キャッシュが全削除され、各ブラウザがクリーンになる)。
 */
const CACHE_VERSION = 'aninovel-v23-2026-05-19';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const AUDIO_CACHE = `${CACHE_VERSION}-audio`;

// 初回アクセスでプリキャッシュする最小セット (オフライン基本動作の保証)
const PRECACHE_URLS = [
  './',
  './index.html',
  './viewer.html',
  './manual.html',
  './404.html',
  './css/portal.css',
  './js/services.js',
  './js/portal.js',
  './js/analytics.js',
  './js/anti-piracy.js',
  './manifest.json',
  './og-image.svg',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch((e) => console.warn('[SW] precache部分失敗', e)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.map((n) => {
        if (!n.startsWith(CACHE_VERSION)) {
          console.info('[SW] 旧キャッシュ削除:', n);
          return caches.delete(n);
        }
      })
    )).then(() => self.clients.claim())
  );
});

function isAudio(url) { return /\.(wav|mp3|ogg|m4a)$/i.test(url.pathname); }
// コード = 常に最新であるべきファイル (network-first)
function isCode(url) { return /\.(css|js)$/i.test(url.pathname); }
// アセット = 変化が少ない画像・フォント (stale-while-revalidate)
function isAsset(url) {
  return /\.(svg|png|jpg|jpeg|webp|woff2?|ttf|otf|ico)$/i.test(url.pathname);
}
function isHTML(url) {
  return url.pathname.endsWith('/') || url.pathname.endsWith('.html');
}
function isCriticalJSON(url) {
  return /\/data\/(catalog\.json|works\/.+\.json|audio\/.+\/manifest\.json)$/i.test(url.pathname);
}

async function networkFirst(request, cacheName) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // HTMLリクエストはオフラインフォールバックを返す
    if (isHTML(new URL(request.url))) {
      return caches.match('./404.html') || new Response('offline', { status: 503 });
    }
    throw e;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, fresh.clone()).catch(() => {});
  }
  return fresh;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 同一オリジンのみ扱う
  if (url.origin !== location.origin) return;
  // 解析・広告・外部API は SW でキャッシュしない
  if (url.pathname.startsWith('/api/') || url.pathname.includes('analytics')) return;

  if (isAudio(url)) {
    // 音声は一度取得したら長期キャッシュ
    event.respondWith(cacheFirst(req, AUDIO_CACHE));
  } else if (isHTML(url) || isCode(url) || isCriticalJSON(url)) {
    // HTML / CSS / JS / 重要JSON は常に最新を取得 (デプロイ即反映)
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
  } else if (isAsset(url)) {
    // 画像・フォントは stale-while-revalidate
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
  }
  // それ以外 (クリーンURL /viewer 等) はデフォルトのネットワーク取得 = 常に最新
});

// ページからのメッセージで強制更新
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((ns) => Promise.all(ns.map((n) => caches.delete(n))));
  }
});
