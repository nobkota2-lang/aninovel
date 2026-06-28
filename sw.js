// sw.js 窶・AniNovel Service Worker
// ------------------------------------------------------------
// 繧ｭ繝｣繝・す繝･謌ｦ逡･:
//   - HTML / JS / CSS・医い繝励Μ譛ｬ菴難ｼ・ : network-first・亥ｸｸ縺ｫ譛譁ｰ縲√が繝輔Λ繧､繝ｳ譎ゅ・縺ｿ繧ｭ繝｣繝・す繝･・・//   - 逕ｻ蜒上・繝輔か繝ｳ繝医・繧｢繧､繧ｳ繝ｳ        : cache-first・・allery/lipsync/icons 遲峨・荳榊､芽ｳ・肇・・//   - /api/* 縺ｨ螟夜Κ繧ｪ繝ｪ繧ｸ繝ｳ           : 莉句・縺励↑縺・ｼ亥ｸｸ縺ｫ繝阪ャ繝医Ρ繝ｼ繧ｯ縲らｿｻ險ｳAPI遲会ｼ・// 譖ｴ譁ｰ:
//   - CACHE_VERSION 繧剃ｸ翫￡繧九→譌ｧ繧ｭ繝｣繝・す繝･繧貞・蜑企勁縺励※菴懊ｊ逶ｴ縺呻ｼ・遒ｺ螳溘↓譛譁ｰ蛹厄ｼ・//   - viewer.html 縺九ｉ {type:'SKIP_WAITING'} 繧貞女縺大叙繧九→蜊ｳ譎よ怏蜉ｹ蛹・竊・閾ｪ蜍輔Μ繝ｭ繝ｼ繝・// ------------------------------------------------------------

const CACHE_VERSION = 'v25-2026-06-28';      // 竊・譖ｴ譁ｰ縺ｮ縺溘・縺ｫ縺薙・蛟､繧剃ｸ翫￡繧・const CACHE_NAME = 'aninovel-' + CACHE_VERSION;

// 繧ｪ繝輔Λ繧､繝ｳ逕ｨ縺ｮ譛蟆上・繝ｪ繧ｭ繝｣繝・す繝･・亥､ｱ謨励＠縺ｦ繧・install 縺ｯ豁｢繧√↑縺・ｼ・const PRECACHE_URLS = ['./', './viewer.html', './manifest.json'];

// network-first 蟇ｾ雎｡・医い繝励Μ譛ｬ菴難ｼ・const APP_SHELL_RE = /\.(?:html|js|css|mjs)$/i;
// cache-first 蟇ｾ雎｡・井ｸ榊､芽ｳ・肇・・const STATIC_ASSET_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|eot|ico)$/i;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(PRECACHE_URLS.map(u => cache.add(u)))
    )
  );
  // 閾ｪ蜍・skipWaiting 縺ｯ縺励↑縺・ｼ域・遉ｺ繝｡繝・そ繝ｼ繧ｸ譎ゅ・縺ｿ・峨ょ・蝗樔ｻ･髯阪・ viewer.html 縺瑚ｦ∵ｱゅ・});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// viewer.html 縺九ｉ蜊ｳ譎よ怏蜉ｹ蛹悶・隕∵ｱゅｒ蜿励￠繧・self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // POST(/api/translate遲・縺ｯ邏騾壹＠

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // 螟夜Κ(Google Fonts/CDN/API)縺ｯ莉句・縺励↑縺・  if (url.pathname.startsWith('/api/')) return;      // 閾ｪ蜑喉PI繧ょｸｸ縺ｫ繝阪ャ繝医Ρ繝ｼ繧ｯ

  // 荳榊､芽ｳ・肇縺ｯ cache-first
  if (STATIC_ASSET_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // 繧｢繝励Μ譛ｬ菴薙・繝翫ン繧ｲ繝ｼ繧ｷ繝ｧ繝ｳ縺ｯ network-first
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
