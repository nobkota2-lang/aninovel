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

/* 作品紹介ページ (/works/) の中身。本文ではなく、どこにも存在しない
 * 解説文を置くための場所。中身の書き方は _worknotes.js の冒頭に書いた。 */
import { readyNotes, noteBySlug } from './_worknotes.js';

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
      try { return await fromCache(context, '/_gen/sitemap', () => sitemapXml(env)); }
      catch (e) { console.warn('[middleware] sitemap:', e); return next(); }
    }
    if (url.pathname === '/works' || url.pathname === '/works/') {
      try { return await fromCache(context, '/_gen/works', () => worksIndexPage(env)); }
      catch (e) { console.warn('[middleware] worksIndex:', e); return next(); }
    }
    if (url.pathname.startsWith('/works/')) {
      try {
        return await fromCache(context, '/_gen' + url.pathname,
          () => workIntroPage(env, url));
      } catch (e) { console.warn('[middleware] workIntro:', e); return next(); }
    }
    const workId = viewerWorkId(url);
    if (workId && isCrawler(request, url)) {
      try {
        return await fromCache(context, '/_gen/ogcard/' + encodeURIComponent(workId),
          () => workCard(context, workId, url));
      } catch (e) { console.warn('[middleware] workCard:', e); return next(); }
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

/**
 * 組み立てたページを Cloudflare の辺縁に預ける。
 * ----------------------------------------------------------------------
 * ここで作るページは、どれも KV を読む。検索エンジンのクローラは同じURLを
 * 何度も叩くので、素のままだと KV の1日あたりの読み取り回数を食い潰す。
 * 無料枠は決して広くないので、2回目以降は辺縁の控えから返す。
 *
 * 鍵は /_gen/... という実在しないパスにしている。本物のURLを鍵にすると、
 * 訪問者ごとに違うはずの応答まで巻き込みかねないため。
 * 控えが壊れていても組み立て直せるので、ここでの失敗は握りつぶしてよい。
 */
async function fromCache(context, keyPath, build) {
  let cache = null;
  let key = null;
  try {
    cache = caches.default;
    key = new Request(new URL(keyPath, context.request.url).toString(),
                      { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch (e) {
    console.warn('[cache] 控えを読めませんでした:', e);
  }

  const res = await build();

  try {
    if (cache && key && res.status === 200) {
      const putting = cache.put(key, res.clone());
      // waitUntil があれば応答を返した後も書き込みを続けさせる。
      // 無い環境でも put 自体は始まっているので、握りつぶすだけでよい。
      if (typeof context.waitUntil === 'function') context.waitUntil(putting);
      else putting.catch(() => {});
    }
  } catch (e) {
    console.warn('[cache] 控えを置けませんでした:', e);
  }
  return res;
}


// KVのバインディング名は WORKS / WORKS_KV の両方がありうる (catalog.js と同じ)
function worksKV(env) {
  return env.WORKS || env.WORKS_KV || null;
}

/**
 * カタログを読む。読めなければ空の配列を返す。
 * ここで例外を投げると、呼び出し側の catch が next() に落ちる。静的ファイルの
 * 無い /works/<slug> ではそれが 404 になるので結果は同じだが、「作品が無い」と
 * 「読めなかった」を同じ空配列に寄せたほうが、各ページの分岐が素直になる。
 */
async function readCatalog(env) {
  const kv = worksKV(env);
  if (!kv) return [];
  try {
    const raw = await kv.get(CATALOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // __catalog__ は配列。{works:[...]} で保存されていた時期の名残にも備える。
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.works)) return parsed.works;
  } catch (e) {
    console.warn('[middleware] カタログを読めませんでした:', e);
  }
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

  // 作品紹介ページ。本文より先に読まれてよいので、作品ページより高く置く。
  try {
    const entries = await introEntries(env);
    if (entries.length) {
      out.push('  <url>');
      out.push('    <loc>' + SITE + '/works/</loc>');
      out.push('    <changefreq>weekly</changefreq>');
      out.push('    <priority>0.8</priority>');
      out.push('  </url>');
    }
    for (const { note } of entries) {
      out.push('  <url>');
      out.push('    <loc>' + SITE + '/works/' + xmlEsc(note.slug) + '</loc>');
      out.push('    <changefreq>monthly</changefreq>');
      out.push('    <priority>0.7</priority>');
      out.push('  </url>');
    }
  } catch (e) {
    console.warn('[sitemap] intros:', e);
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

/* =====================================================================
 * 作品紹介ページ  /works/  と  /works/<slug>
 * =====================================================================
 * ビューワの本文は JavaScript で描いているので、検索エンジンに読まれるか
 * 確実ではない。こちらは組み立て済みの HTML を返すので確実に読まれる。
 *
 * クローラにだけ別の中身を見せるのはクローキングという違反行為なので、
 * このページは誰に対しても同じものを返す。
 *
 * 【要加筆】【要確認】の入った下書き部分は、公開されるページには出さない。
 * 書きかけの覚え書きが読者の目に触れると、かえって信用を損なうため。
 */

function htmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 下書きの印から後ろは公開しない。 */
function publicText(s) {
  const v = String(s == null ? '' : s);
  const i = v.indexOf('【');
  return (i >= 0 ? v.slice(0, i) : v).trim();
}

/** 出典から「(…【要確認】)」のような但し書きを落とす。 */
function publicSource(s) {
  const v = String(s == null ? '' : s).trim();
  if (!v.includes('【')) return v;
  const i = v.indexOf('（');
  return (i > 0 ? v.slice(0, i) : '').trim();
}

function paragraphs(text) {
  return publicText(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => '<p>' + htmlEsc(p) + '</p>')
    .join('\n');
}

const PAGE_CSS = `
:root{--bg:#faf8f5;--card:#fff;--ink:#2d2a26;--muted:#6b645c;
  --line:#e5ded4;--accent:#8b5e34;--accent2:#a67c52;box-sizing:border-box}
*,*::before,*::after{box-sizing:inherit}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#1c1a18;--card:#262320;--ink:#ece7e0;--muted:#a49a8e;
  --line:#3a352f;--accent:#c9a227;--accent2:#d4b24c}}
:root[data-theme="dark"]{--bg:#1c1a18;--card:#262320;--ink:#ece7e0;
  --muted:#a49a8e;--line:#3a352f;--accent:#c9a227;--accent2:#d4b24c}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.9;
  font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;
  -webkit-text-size-adjust:100%}
.wrap{max-width:720px;margin:0 auto;padding:28px 16px 72px}
.crumb{font-size:.84rem;color:var(--muted);margin-bottom:22px}
.crumb a{color:var(--muted)}
h1{font-size:1.72rem;line-height:1.45;margin:0 0 10px;letter-spacing:.01em}
.by{color:var(--muted);font-size:.95rem;margin:0 0 4px}
.facts{color:var(--muted);font-size:.84rem;margin:0 0 26px}
blockquote{margin:0 0 26px;padding:16px 20px;background:var(--card);
  border-left:3px solid var(--accent);border-radius:0 10px 10px 0;
  font-size:1.02rem;color:var(--ink)}
blockquote p{margin:0}
.body p{margin:0 0 18px}
a{color:var(--accent)}
.cta{margin:32px 0 10px}
.btn{display:inline-block;padding:14px 32px;border-radius:10px;
  background:var(--accent);color:#fff;font-weight:700;text-decoration:none}
.btn:hover{background:var(--accent2)}
.src{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);
  font-size:.84rem;color:var(--muted)}
.more{margin-top:40px;padding-top:22px;border-top:1px solid var(--line)}
.more h2{font-size:1rem;margin:0 0 12px}
.more ul{margin:0;padding-left:1.2em}
.more li{margin-bottom:7px;font-size:.92rem}
.list{list-style:none;padding:0;margin:0}
.list li{background:var(--card);border:1px solid var(--line);border-radius:12px;
  padding:18px 20px;margin-bottom:12px}
.list h2{font-size:1.1rem;margin:0 0 4px}
.list h2 a{text-decoration:none}
.list .by{margin:0 0 8px;font-size:.86rem}
.list p.ex{margin:0;font-size:.92rem;color:var(--muted)}
.foot{margin-top:40px;font-size:.86rem;color:var(--muted);text-align:center}
`.trim();

function page(opts) {
  return '<!DOCTYPE html>\n<html lang="ja">\n<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + '<title>' + htmlEsc(opts.title) + '</title>\n'
    + '<meta name="description" content="' + htmlEsc(opts.desc) + '">\n'
    + '<link rel="canonical" href="' + htmlEsc(opts.url) + '">\n'
    + '<meta property="og:type" content="' + (opts.ogType || 'website') + '">\n'
    + '<meta property="og:site_name" content="アニノベル">\n'
    + '<meta property="og:title" content="' + htmlEsc(opts.title) + '">\n'
    + '<meta property="og:description" content="' + htmlEsc(opts.desc) + '">\n'
    + '<meta property="og:url" content="' + htmlEsc(opts.url) + '">\n'
    + '<meta property="og:image" content="' + SITE + '/og-image.png">\n'
    + '<meta property="og:image:width" content="1200">\n'
    + '<meta property="og:image:height" content="630">\n'
    + '<meta property="og:locale" content="ja_JP">\n'
    + '<meta name="twitter:card" content="summary_large_image">\n'
    + '<meta name="twitter:title" content="' + htmlEsc(opts.title) + '">\n'
    + '<meta name="twitter:description" content="' + htmlEsc(opts.desc) + '">\n'
    + '<meta name="twitter:image" content="' + SITE + '/og-image.png">\n'
    + '<style>' + PAGE_CSS + '</style>\n'
    + '</head>\n<body>\n<div class="wrap">\n' + opts.body + '\n</div>\n</body>\n</html>\n';
}

function htmlResponse(html, status) {
  return new Response(html, {
    status: status || 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
}

/** カタログに載っていて、かつ解説が書けている作品だけを並べる。 */
async function introEntries(env) {
  const works = await readCatalog(env);
  const out = [];
  for (const n of readyNotes()) {
    if (!publicText(n.intro)) continue;       // 下書きの印しかない行は出さない
    const w = works.find((x) => x && (
      (n.id && x.id === n.id) || (x.title === n.title)
    ));
    if (!w) continue;                         // 公開されていない作品は出さない
    out.push({ note: n, work: w });
  }
  return out;
}

async function worksIndexPage(env) {
  const entries = await introEntries(env);
  if (!entries.length) return htmlResponse(page({
    title: '作品紹介 — アニノベル',
    desc: '作品の紹介ページを準備しています。',
    url: SITE + '/works/',
    body: '<p class="crumb"><a href="/">アニノベル</a> › 作品紹介</p>'
        + '<h1>作品紹介</h1><p>ただいま準備中です。</p>'
        + '<p class="foot"><a href="/">作品一覧へ</a></p>',
  }));

  let li = '';
  for (const { note, work } of entries) {
    const intro = publicText(note.intro).replace(/\s+/g, ' ');
    li += '<li><h2><a href="/works/' + htmlEsc(note.slug) + '">'
        + htmlEsc(note.title) + '</a></h2>'
        + '<p class="by">' + htmlEsc(note.author || work.author || '') + '</p>'
        + '<p class="ex">' + htmlEsc(intro.slice(0, 110))
        + (intro.length > 110 ? '…' : '') + '</p></li>\n';
  }

  return htmlResponse(page({
    title: '作品紹介 — アニノベル',
    desc: 'アニノベルで公開している作品の紹介です。'
        + 'どんな話で、どこが読みどころかをまとめています。',
    url: SITE + '/works/',
    body: '<p class="crumb"><a href="/">アニノベル</a> › 作品紹介</p>\n'
        + '<h1>作品紹介</h1>\n'
        + '<p class="facts">アニメ風の吹き出しと読み上げで読める作品を、'
        + '一編ずつご紹介します。</p>\n'
        + '<ul class="list">\n' + li + '</ul>\n'
        + '<p class="foot"><a href="/">作品一覧へ</a>　'
        + '<a href="/authors.html">作品を書く方へ</a></p>',
  }));
}

async function workIntroPage(env, url) {
  const slug = decodeURIComponent(url.pathname.slice('/works/'.length)).split('/')[0];
  const note = noteBySlug(slug);
  if (!note || !publicText(note.intro)) return htmlResponse(page({
    title: '見つかりませんでした — アニノベル',
    desc: 'お探しの作品紹介は見つかりませんでした。',
    url: SITE + '/works/',
    body: '<h1>見つかりませんでした</h1>'
        + '<p>お探しの作品紹介はありません。</p>'
        + '<p class="foot"><a href="/works/">作品紹介の一覧へ</a>　'
        + '<a href="/">トップへ</a></p>',
  }), 404);

  const works = await readCatalog(env);
  const work = works.find((x) => x && (
    (note.id && x.id === note.id) || (x.title === note.title)
  ));
  if (!work) return htmlResponse(page({
    title: '見つかりませんでした — アニノベル',
    desc: 'お探しの作品紹介は見つかりませんでした。',
    url: SITE + '/works/',
    body: '<h1>見つかりませんでした</h1>'
        + '<p>この作品はいま公開されていません。</p>'
        + '<p class="foot"><a href="/works/">作品紹介の一覧へ</a></p>',
  }), 404);

  const intro = publicText(note.intro);
  const author = note.author || work.author || '';
  const facts = [];
  if (note.year) facts.push(htmlEsc(note.year));
  if (work.charCount) facts.push('約' + Number(work.charCount).toLocaleString('ja-JP') + '字');
  const src = publicSource(note.source);

  let body = '<p class="crumb"><a href="/">アニノベル</a> › '
    + '<a href="/works/">作品紹介</a> › ' + htmlEsc(note.title) + '</p>\n'
    + '<h1>' + htmlEsc(note.title) + '</h1>\n'
    + (author ? '<p class="by">' + htmlEsc(author) + '</p>\n' : '')
    + (facts.length ? '<p class="facts">' + facts.join('　·　') + '</p>\n' : '');

  if (note.lead) {
    body += '<blockquote><p>' + htmlEsc(note.lead) + '</p></blockquote>\n';
  }
  body += '<div class="body">\n' + paragraphs(intro) + '\n</div>\n';
  body += '<p class="cta"><a class="btn" href="/viewer.html?work='
        + encodeURIComponent(work.id) + '">この作品を読む</a></p>\n';
  if (src) {
    body += '<p class="src">出典: ' + htmlEsc(src)
          + '。著作権の保護期間が満了した作品です。</p>\n';
  }

  // 内部リンク。孤立したページを作らないため、他の紹介へも必ず繋ぐ。
  const others = (await introEntries(env))
    .filter((e) => e.note.slug !== note.slug).slice(0, 5);
  if (others.length) {
    body += '<div class="more"><h2>ほかの作品</h2><ul>\n';
    for (const o of others) {
      body += '<li><a href="/works/' + htmlEsc(o.note.slug) + '">'
            + htmlEsc(o.note.title) + '</a>'
            + (o.note.author ? '（' + htmlEsc(o.note.author) + '）' : '')
            + '</li>\n';
    }
    body += '</ul></div>\n';
  }
  body += '<p class="foot"><a href="/works/">作品紹介の一覧へ</a>　'
        + '<a href="/">トップへ</a></p>';

  const desc = intro.replace(/\s+/g, ' ').slice(0, 120);
  return htmlResponse(page({
    title: note.title + '｜' + author + '｜アニノベル',
    desc: desc,
    url: SITE + '/works/' + encodeURIComponent(note.slug),
    ogType: 'article',
    body: body,
  }));
}
