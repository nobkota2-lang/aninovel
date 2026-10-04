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

  // ===== /api/* 以外 =====
  // 原則は素通し。例外は二つだけで、どちらも失敗したら素通しに戻す。
  // ここで例外を投げるとサイト全体が落ちるので、必ず握りつぶすこと。
  if (!url.pathname.startsWith('/api/')) {
    if (url.pathname === '/sitemap.xml') {
      try { return await sitemapXml(env); } catch (e) {
        console.warn('[middleware] sitemap:', e);
        return next();
      }
    }
    const workId = viewerWorkId(url);
    if (workId && isCrawler(request, url)) {
      try { return await workCard(context, workId, url); } catch (e) {
        console.warn('[middleware] workCard:', e);
        return next();
      }
    }
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

/* =====================================================================
 * ここから下: 検索と共有のための処理
 * =====================================================================
 * 2026-10-04 追加。
 *
 * 直す前の状態:
 *   - sitemap.xml が手書きのまま止まっていて、存在しない3作品
 *     (summer-adventure / mystery-garden / starlight-cafe) を載せ、
 *     実在する作品を1つも載せていなかった。
 *   - どの作品を共有しても、カードの題名が「アニノベル - 作品ビューワ」
 *     になった。作品名も作者名も出ない。
 *
 * 方針:
 *   sitemap は KV の __catalog__ から毎回組み立てる。手書きに戻すと
 *   また必ず古くなる。
 *   作品ごとのカードは、クローラが来たときだけ組み立てる。読者の
 *   表示を遅くしたくないため。タブの題名は viewer.html 側で直した。
 */

const SITE = 'https://aninovel.com';
const CATALOG_KEY = '__catalog__';

// KVのバインディング名は WORKS / WORKS_KV の両方がありうる (catalog.js と同じ)
function worksKV(env) {
  return env.WORKS || env.WORKS_KV || null;
}

async function readCatalog(env) {
  const kv = worksKV(env);
  if (!kv) return [];
  const raw = await kv.get(CATALOG_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  // __catalog__ は配列。{works:[...]} で保存されていた時期の名残にも備える。
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.works)) return parsed.works;
  return [];
}

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// 作者向け・読者向けで、検索に出てよいページだけ。
// 管理画面 (admin-authors.html)、ポイント画面 (points.html)、
// ログイン・登録・確認画面はここに入れないこと。
const STATIC_PAGES = [
  ['/',                         'daily',   '1.0'],
  ['/authors.html',             'weekly',  '0.9'],
  ['/author-apply.html',        'monthly', '0.6'],
  ['/manual.html',              'monthly', '0.5'],
  ['/legal/revenue.html',       'monthly', '0.4'],
  ['/legal/terms.html',         'yearly',  '0.3'],
  ['/legal/privacy.html',       'yearly',  '0.3'],
  ['/legal/tokushoho.html',     'yearly',  '0.2'],
  ['/legal/dmca.html',          'yearly',  '0.2'],
  ['/legal/accessibility.html', 'yearly',  '0.2'],
];

async function sitemapXml(env) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  for (const [path, freq, pri] of STATIC_PAGES) {
    out.push('  <url>');
    out.push('    <loc>' + SITE + path + '</loc>');
    out.push('    <changefreq>' + freq + '</changefreq>');
    out.push('    <priority>' + pri + '</priority>');
    out.push('  </url>');
  }

  let works = [];
  try { works = await readCatalog(env); } catch (e) {
    console.warn('[sitemap] catalog:', e);
  }
  for (const w of works) {
    if (!w || !w.id) continue;
    out.push('  <url>');
    out.push('    <loc>' + SITE + '/viewer.html?work=' + xmlEsc(w.id) + '</loc>');
    const d = String(w.updatedAt || w.createdAt || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) out.push('    <lastmod>' + d + '</lastmod>');
    out.push('    <changefreq>weekly</changefreq>');
    out.push('    <priority>0.8</priority>');
    out.push('  </url>');
  }

  out.push('</urlset>');
  return new Response(out.join('\n'), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // 作品を公開してから検索側に伝わるまで最大1時間。待てる範囲。
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/** /viewer.html?work=ID と /work/ID の両方から作品IDを取る。 */
function viewerWorkId(url) {
  if (url.pathname === '/viewer.html') {
    return url.searchParams.get('work') || '';
  }
  if (url.pathname.startsWith('/work/')) {
    return decodeURIComponent(url.pathname.slice('/work/'.length)).split('/')[0];
  }
  return '';
}

// 共有カードを作るのはこの顔ぶれ。取りこぼしても元の汎用カードに戻るだけで、
// 壊れはしない。_og=1 を付けると自分の目でも確かめられる。
const CARD_UA = /bot|crawler|spider|facebookexternalhit|twitterbot|slackbot|discordbot|linkedinbot|whatsapp|telegram|pinterest|embedly|redditbot|applebot|mastodon|misskey|hatena|skypeuripreview|line\//i;

function isCrawler(request, url) {
  if (url.searchParams.get('_og') === '1') return true;
  return CARD_UA.test(request.headers.get('User-Agent') || '');
}

function trim(s, n) {
  const v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
}

/**
 * 属性値に入れる前の下ごしらえ。
 * HTMLRewriter の setAttribute は " しか直してくれない。題名に & や <
 * が入っていると生のまま出る。& が実体参照に化けうる (「A &copy B」が
 * 「A © B」になる) ので、ここで先に直しておく。" は二重に直さないよう
 * 触らない。
 */
function attrSafe(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 作品ごとの共有カード。
 * 本文 (work:<id>) は大きいので読まない。カタログの1行で足りる。
 */
async function workCard(context, workId, url) {
  const { env, next } = context;
  const res = await next();
  const ct = res.headers.get('Content-Type') || '';
  // 404 ページにカードを付けない。/work/* の書き換えが効いていない環境では
  // ここに 404 が来る。
  if (res.status !== 200 || !ct.includes('text/html')) return res;

  const works = await readCatalog(env);
  const w = works.find(x => x && x.id === workId);
  if (!w) return res;

  const title  = trim(w.title || w.titleEn, 80) || '無題';
  const author = trim(w.author || w.authorEn, 40);
  const headline = author ? (title + '｜' + author) : title;

  // 概要が「題名 by 作者」のような自動生成文のときは、隣の行と同じことしか
  // 言わないので使わない (portal.js の _rankDesc と同じ考え方)。
  let desc = trim(w.description || w.descriptionEn, 150);
  if (desc && (desc === title || desc === title + ' by ' + author ||
               desc === title + ' / ' + author)) desc = '';
  if (!desc) desc = 'アニメ風の吹き出しと読み上げで読めます。';

  const canonical = SITE + '/viewer.html?work=' + encodeURIComponent(workId);

  const setContent = v => ({
    element(el) { el.setAttribute('content', attrSafe(v)); }
  });

  const out = new HTMLRewriter()
    .on('title', {
      // setInnerContent なら中身をまるごと差し替えられる。text ハンドラだと
      // 題名が複数のチャンクに割れたときに重複する。
      element(el) { el.setInnerContent(headline + '｜アニノベル'); }
    })
    .on('meta[property="og:title"]',       setContent(headline))
    .on('meta[name="twitter:title"]',      setContent(headline))
    .on('meta[property="og:description"]', setContent(desc))
    .on('meta[name="twitter:description"]',setContent(desc))
    .on('meta[name="description"]',        setContent(desc))
    .on('meta[property="og:url"]',         setContent(canonical))
    .on('link[rel="canonical"]', {
      element(el) { el.setAttribute('href', canonical); }
    })
    .transform(res);

  const h = new Headers(out.headers);
  h.set('Cache-Control', 'public, max-age=600');
  h.set('Vary', 'User-Agent');
  return new Response(out.body, { status: out.status, statusText: out.statusText, headers: h });
}
