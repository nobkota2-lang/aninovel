// sw.js — AniNovel Service Worker
// ------------------------------------------------------------
// キャッシュ方針:
//   - HTML / JS / CSS（アプリ本体） : network-first（常に最新。オフライン時だけキャッシュ）
//   - 画像・フォント・アイコン       : stale-while-revalidate（すぐ出し、裏で入れ替える）
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
//
// 2026-10-26 の変更:
//   画像を cache-first で持っていたため、差し替えた口パクGIFが
//   読者にいつまでも届かなかった。CACHE_VERSION を上げるまで
//   古いものを返し続ける作りで、実際に取りこぼした。
//   画像は「不変の資産」ではない、というのが今回の学び。
//   stale-while-revalidate に変える。表示はこれまでどおりキャッシュから
//   即座に出し、裏でネットワークから取り直してキャッシュを入れ替える。
//   古いまま見えるのは差し替え後の最初の1回だけで、次からは新しくなる。
//   CACHE_VERSION を上げ忘れても自力で直る。
// ------------------------------------------------------------

const CACHE_VERSION = 'v32-2026-10-26';
const CACHE_NAME = 'aninovel-' + CACHE_VERSION;

// オフライン用の最小限のプリキャッシュ（失敗しても install は止めない）
const PRECACHE_URLS = ['./', './viewer.html', './manifest.json'];

// network-first の対象（アプリ本体）
const APP_SHELL_RE = /\.(?:html|js|css|mjs)$/i;

// stale-while-revalidate の対象（差し替わりうる資産）
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

  // 画像・フォントは stale-while-revalidate
  if (STATIC_ASSET_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, req));
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

// キャッシュがあればそれを返し、裏でネットワークから取り直して入れ替える。
// 入れ替えは event.waitUntil に預ける。respondWith が先に解決しても、
// ブラウザが Service Worker を止めずに最後まで走らせてくれる。
async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  // 取り直しは必ずサーバーに確かめる。
  // 素の fetch(req) だとブラウザのHTTPキャッシュ(max-age=14400)に当たり、
  // 4時間のあいだ古いものを拾い直してしまう。
  // no-cache なら If-None-Match が付き、変わっていなければ 304 で済む。
  const fetching = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then(res => {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    // waitUntil が使えない状況でも落とさない（取り直しは走らせたまま）
    try { event.waitUntil(fetching); } catch (e) { /* noop */ }
    return cached;
  }

  const res = await fetching;
  if (res) return res;
  throw new Error('offline and not cached: ' + req.url);
}
