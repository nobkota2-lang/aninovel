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

/* 回数の数え方について  (2026-10-06 変更)
 * ----------------------------------------------------------------------
 * 以前はすべての /api/* で KV に1回書き込んでいた。これが致命的だった。
 * KV の書き込みは無料枠で1日1,000回しかない。音声は1ブロック1ファイルなので、
 * 『吾輩は猫である』を読み上げで通して聞くだけで、読者ひとりで枠を使い切る。
 * 2026-10-04 に実際に超過して、KV の書き込みが丸一日止まった。
 *
 * そこで、数える場所を2つに分けた。
 *   store:'kv' … 呼ばれる回数が少なく、乱用されると実害が大きい窓口だけ。
 *                1日に数十回も書かないので、枠を圧迫しない。
 *   既定       … 辺縁の控え(Cache API)で数える。書き込みは無料で無制限。
 *
 * 控えで数える弱点は、拠点ごとに別勘定になることと、同時アクセスで取りこぼす
 * ことの2つ。ただし KV も結果整合で読み取りが60秒ほど辺縁に残るため、
 * もともと厳密ではなかった。精度は実質変わらず、枠だけが空く。
 */
const RATE_LIMIT = {
  '/api/newsletter': { max: 5, windowSec: 600, store: 'kv' },   // 10分5回まで
  '/api/reports': { max: 10, windowSec: 600, store: 'kv' },     // 10分10回まで
  '/api/billing': { max: 20, windowSec: 600, store: 'kv' },     // 課金フロー
  '/api/errors': { max: 50, windowSec: 600 },      // 10分50回まで
  // 音声は1ブロック1ファイル。読者は5秒に1件ほどしか要らない (約12回/分)。
  // 40回/分なら読者に3倍の余裕がありつつ、全作品(約7,600件)の一括取得には
  // 1IPあたり3時間以上かかる。ただし複数IPを使う相手には効かない。
  // 本命はホットリンク防止のほうで、これは補助。
  '/api/audio': { max: 40, windowSec: 60 },
  default: { max: 60, windowSec: 60 },             // 1分60回
};

/**
 * KV で数える。書き込み枠を食うので、低頻度の窓口だけ。
 * 上限に達した後は書かない。書き続けると、叩いてくる相手に KV の書き込み枠を
 * 好きなだけ削らせることになる。止めるための仕組みが、止めたい相手の武器に
 * なってしまう。
 */
async function countInKV(env, key, windowSec, max) {
  if (!env.RATE_LIMIT_KV) return null;             // 未設定なら数えない
  const cur = parseInt(await env.RATE_LIMIT_KV.get(key) || '0', 10);
  if (cur < max) {
    await env.RATE_LIMIT_KV.put(key, String(cur + 1),
                                { expirationTtl: windowSec + 60 });
  }
  return cur;
}

/**
 * 辺縁の控えで数える。書き込みは無料。
 * 鍵は実在しない /_rl/... にする。中身はただの数字なので、万一そのURLが
 * 読まれても漏れて困るものは無い。
 */
async function countInCache(context, key, windowSec, max) {
  const cache = caches.default;
  const req = new Request(
    new URL('/_rl/' + encodeURIComponent(key), context.request.url).toString(),
    { method: 'GET' });

  let cur = 0;
  const hit = await cache.match(req);
  if (hit) cur = parseInt(await hit.text(), 10) || 0;

  // 上限に達したら、もう数えない (KV の側と揃える)
  if (cur >= max) return cur;

  const putting = cache.put(req, new Response(String(cur + 1), {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'max-age=' + (windowSec + 60),
    },
  }));
  if (typeof context.waitUntil === 'function') context.waitUntil(putting);
  else putting.catch(() => {});

  return cur;
}

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
    // 作品紹介。日本語は /works/、英語は /en/works/。
    // 英訳はあるのに英語のURLが無く、英語圏の検索に一切出ていなかった。
    // 英語の入口。/en/works/ の上に英語のトップが無く、英語圏から来た人の
    // 着地点が存在しなかった。日本語のトップに落ちても読めない。
    if (url.pathname === '/en' || url.pathname === '/en/') {
      try { return await fromCache(context, '/_gen/en-home', () => enHomePage(env)); }
      catch (e) { console.warn('[middleware] enHome:', e); return next(); }
    }
    if (url.pathname === '/en/authors' || url.pathname === '/en/authors/') {
      try { return await fromCache(context, '/_gen/en-authors', () => enAuthorsPage()); }
      catch (e) { console.warn('[middleware] enAuthors:', e); return next(); }
    }

    const intro = introRoute(url.pathname);
    if (intro) {
      if (intro.slug === null) {
        try {
          return await fromCache(context, '/_gen/works-' + intro.lang,
            () => worksIndexPage(env, intro.lang));
        } catch (e) { console.warn('[middleware] worksIndex:', e); return next(); }
      }
      try {
        return await fromCache(context, '/_gen' + url.pathname,
          () => workIntroPage(env, intro.slug, intro.lang));
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

  // ===== レート制限 =====
  {
    const limit = pickLimit(url.pathname);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const bucket = Math.floor(Date.now() / 1000 / limit.windowSec);
    const key = `rl:${url.pathname}:${ip}:${bucket}`;
    try {
      const cur = (limit.store === 'kv')
        ? await countInKV(env, key, limit.windowSec, limit.max)
        : await countInCache(context, key, limit.windowSec, limit.max);
      if (cur !== null && cur >= limit.max) {
        return json({
          error: 'rate_limited',
          message: 'リクエストが多すぎます。しばらくしてから再度お試しください。',
          retryAfter: limit.windowSec
        }, 429, { 'Retry-After': String(limit.windowSec) });
      }
    } catch (e) {
      console.warn('[middleware] rate limit error:', e);
      // 数えられなくてもリクエストは通す (フェイルオープン)
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

  // 英語の入口。英語圏から来た人の着地点なので、紹介ページより高く置く。
  for (const [path, pri] of [['/en/', '0.9'], ['/en/authors', '0.7']]) {
    out.push('  <url>');
    out.push('    <loc>' + SITE + path + '</loc>');
    out.push('    <changefreq>weekly</changefreq>');
    out.push('    <priority>' + pri + '</priority>');
    out.push('  </url>');
  }

  // 作品紹介ページ。本文より先に読まれてよいので、作品ページより高く置く。
  // 日英それぞれ別のURLなので、両方載せる。中身が対になっていることは
  // ページ側の hreflang で伝えている。
  for (const lang of ['ja', 'en']) {
    try {
      const entries = await introEntries(env, lang);
      if (!entries.length) continue;
      const base = SITE + (lang === 'en' ? '/en/works/' : '/works/');
      out.push('  <url>');
      out.push('    <loc>' + base + '</loc>');
      out.push('    <changefreq>weekly</changefreq>');
      out.push('    <priority>' + (lang === 'ja' ? '0.8' : '0.6') + '</priority>');
      out.push('  </url>');
      for (const { note } of entries) {
        out.push('  <url>');
        out.push('    <loc>' + base + xmlEsc(note.slug) + '</loc>');
        out.push('    <changefreq>monthly</changefreq>');
        out.push('    <priority>' + (lang === 'ja' ? '0.7' : '0.6') + '</priority>');
        out.push('  </url>');
      }
    } catch (e) {
      console.warn('[sitemap] intros ' + lang + ':', e);
    }
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

/**
 * 紹介ページの振り分け。
 *   /works/              → {lang:'ja', slug:null}   一覧
 *   /works/rashomon      → {lang:'ja', slug:'rashomon'}
 *   /en/works/           → {lang:'en', slug:null}
 *   /en/works/rashomon   → {lang:'en', slug:'rashomon'}
 * それ以外は null。
 */
function introRoute(pathname) {
  let lang = 'ja';
  let rest = pathname;
  if (rest === '/en/works' || rest.startsWith('/en/works/')) {
    lang = 'en';
    rest = rest.slice('/en'.length);
  }
  if (rest === '/works' || rest === '/works/') return { lang, slug: null };
  if (!rest.startsWith('/works/')) return null;
  const slug = decodeURIComponent(rest.slice('/works/'.length)).split('/')[0];
  return slug ? { lang, slug } : { lang, slug: null };
}

/** その言語での表示に使う値を取り出す。英語が無ければ日本語に戻す。 */
function pick(note, field, lang) {
  if (lang === 'en') {
    const v = note[field + 'En'];
    if (v && String(v).trim()) return v;
    return '';            // 英語が無いなら出さない。日本語を混ぜない。
  }
  return note[field] || '';
}

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
ul.plain{list-style:none;padding:0;margin:0 0 14px}
ul.plain li{padding:7px 0;border-bottom:1px solid var(--line)}
ul.plain li:last-child{border-bottom:0}
ul.plain a{text-decoration:none;font-weight:700}
ul.plain .by{color:var(--muted);font-weight:400;font-size:.88rem}
.lead{font-size:1.05rem;margin:0 0 22px}
.list p.ex{margin:0;font-size:.92rem;color:var(--muted)}
.foot{margin-top:40px;font-size:.86rem;color:var(--muted);text-align:center}
`.trim();

function page(opts) {
  const en = opts.lang === 'en';

  // hreflang。同じ中身の別言語版がどこにあるかを検索エンジンに伝える。
  // これが無いと、日英が重複した別々のページと見なされかねない。
  // x-default は、どの言語でもない利用者に見せる版。作者が日本の方なので
  // 日本語を既定にしている。
  let alt = '';
  if (opts.altJa && opts.altEn) {
    alt = '<link rel="alternate" hreflang="ja" href="' + htmlEsc(opts.altJa) + '">\n'
        + '<link rel="alternate" hreflang="en" href="' + htmlEsc(opts.altEn) + '">\n'
        + '<link rel="alternate" hreflang="x-default" href="' + htmlEsc(opts.altJa) + '">\n';
  }

  return '<!DOCTYPE html>\n<html lang="' + (en ? 'en' : 'ja') + '">\n<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + '<title>' + htmlEsc(opts.title) + '</title>\n'
    + '<meta name="description" content="' + htmlEsc(opts.desc) + '">\n'
    + '<link rel="canonical" href="' + htmlEsc(opts.url) + '">\n'
    + alt
    + '<meta property="og:type" content="' + (opts.ogType || 'website') + '">\n'
    + '<meta property="og:site_name" content="' + (en ? 'AniNovel' : 'アニノベル') + '">\n'
    + '<meta property="og:title" content="' + htmlEsc(opts.title) + '">\n'
    + '<meta property="og:description" content="' + htmlEsc(opts.desc) + '">\n'
    + '<meta property="og:url" content="' + htmlEsc(opts.url) + '">\n'
    + '<meta property="og:image" content="' + SITE + '/og-image.png">\n'
    + '<meta property="og:image:width" content="1200">\n'
    + '<meta property="og:image:height" content="630">\n'
    + '<meta property="og:locale" content="' + (en ? 'en_US' : 'ja_JP') + '">\n'
    + '<meta name="twitter:card" content="summary_large_image">\n'
    + '<meta name="twitter:title" content="' + htmlEsc(opts.title) + '">\n'
    + '<meta name="twitter:description" content="' + htmlEsc(opts.desc) + '">\n'
    + '<meta name="twitter:image" content="' + SITE + '/og-image.png">\n'
    + '<style>' + PAGE_CSS + '</style>\n'
    + '</head>\n<body>\n<div class="wrap">\n' + opts.body + '\n</div>\n</body>\n</html>\n';
}

/** 画面に出す文言。日英で持ち替える。 */
const UI = {
  ja: {
    site: 'アニノベル', intros: '作品紹介',
    lead: 'アニメ風の吹き出しと読み上げで読める作品を、一編ずつご紹介します。',
    indexDesc: 'アニノベルで公開している作品の紹介です。どんな話で、どこが読みどころかをまとめています。',
    read: 'この作品を読む', others: 'ほかの作品', toList: '作品紹介の一覧へ',
    toTop: 'トップへ', works: '作品一覧へ', writers: '作品を書く方へ',
    notFound: '見つかりませんでした',
    notFoundBody: 'お探しの作品紹介はありません。',
    notPublished: 'この作品はいま公開されていません。',
    preparing: 'ただいま準備中です。',
    source: '出典: ', pd: '。著作権の保護期間が満了した作品です。',
    chars: (n) => '約' + n + '字', other: 'English',
  },
  en: {
    site: 'AniNovel', intros: 'The works',
    lead: 'Each work on AniNovel, introduced one at a time. Read with '
        + 'anime-style speech bubbles and narration.',
    indexDesc: 'Introductions to the works published on AniNovel: what each one '
        + 'is, and what to look out for.',
    read: 'Read this work', others: 'Other works', toList: 'All introductions',
    toTop: 'Home', works: 'Browse the works', writers: 'For writers',
    notFound: 'Not found',
    notFoundBody: 'There is no introduction at this address.',
    notPublished: 'This work is not currently published.',
    preparing: 'Coming soon.',
    source: 'Source: ', pd: '. The copyright on this work has expired.',
    chars: (n) => n + ' characters', other: '日本語',
  },
};

function htmlResponse(html, status) {
  return new Response(html, {
    status: status || 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
}

/**
 * カタログに載っていて、かつその言語の解説が書けている作品だけを並べる。
 * 英語の解説が無い作品は英語の一覧に出さない。日本語を混ぜて出すと、
 * 英語で来た人に半分日本語のページを見せることになる。
 */
async function introEntries(env, lang) {
  const works = await readCatalog(env);
  const out = [];
  for (const n of readyNotes()) {
    if (!publicText(pick(n, 'intro', lang))) continue;
    const w = works.find((x) => x && (
      (n.id && x.id === n.id) || (x.title === n.title)
    ));
    if (!w) continue;                         // 公開されていない作品は出さない
    out.push({ note: n, work: w });
  }
  return out;
}

/** その作品の日英それぞれのURL。hreflang と言語切替に使う。 */
function introUrls(slug) {
  const s = encodeURIComponent(slug);
  return { ja: SITE + '/works/' + s, en: SITE + '/en/works/' + s };
}

/** 反対の言語の版があるか。無ければ hreflang も切替リンクも出さない。 */
function hasBoth(note) {
  return !!(publicText(note.intro) && publicText(note.introEn));
}

function introHome(lang) { return lang === 'en' ? '/en/works/' : '/works/'; }

async function worksIndexPage(env, lang) {
  const t = UI[lang];
  const entries = await introEntries(env, lang);
  const urls = { ja: SITE + '/works/', en: SITE + '/en/works/' };

  if (!entries.length) return htmlResponse(page({
    lang: lang,
    title: t.intros + ' — ' + t.site,
    desc: t.preparing,
    url: urls[lang],
    body: '<p class="crumb"><a href="/">' + t.site + '</a> › ' + t.intros + '</p>'
        + '<h1>' + t.intros + '</h1><p>' + t.preparing + '</p>'
        + '<p class="foot"><a href="/">' + t.works + '</a></p>',
  }));

  let li = '';
  for (const { note, work } of entries) {
    const intro = publicText(pick(note, 'intro', lang)).replace(/\s+/g, ' ');
    const title = pick(note, 'title', lang) || note.title;
    const author = pick(note, 'author', lang) || note.author || work.author || '';
    li += '<li><h2><a href="' + introHome(lang) + htmlEsc(note.slug) + '">'
        + htmlEsc(title) + '</a></h2>'
        + '<p class="by">' + htmlEsc(author) + '</p>'
        + '<p class="ex">' + htmlEsc(intro.slice(0, 110))
        + (intro.length > 110 ? '…' : '') + '</p></li>\n';
  }

  return htmlResponse(page({
    lang: lang,
    title: t.intros + ' — ' + t.site,
    desc: t.indexDesc,
    url: urls[lang],
    altJa: urls.ja, altEn: urls.en,
    body: '<p class="crumb"><a href="/">' + t.site + '</a> › ' + t.intros
        + '　<a href="' + introHome(lang === 'en' ? 'ja' : 'en') + '">'
        + t.other + '</a></p>\n'
        + '<h1>' + t.intros + '</h1>\n'
        + '<p class="facts">' + t.lead + '</p>\n'
        + '<ul class="list">\n' + li + '</ul>\n'
        + '<p class="foot"><a href="/">' + t.works + '</a>　'
        + '<a href="/authors.html">' + t.writers + '</a></p>',
  }));
}

async function workIntroPage(env, slug, lang) {
  const t = UI[lang];
  const note = noteBySlug(slug);
  const intro = note ? publicText(pick(note, 'intro', lang)) : '';

  if (!note || !intro) return htmlResponse(page({
    lang: lang,
    title: t.notFound + ' — ' + t.site,
    desc: t.notFoundBody,
    url: SITE + introHome(lang),
    body: '<h1>' + t.notFound + '</h1>'
        + '<p>' + t.notFoundBody + '</p>'
        + '<p class="foot"><a href="' + introHome(lang) + '">' + t.toList + '</a>　'
        + '<a href="/">' + t.toTop + '</a></p>',
  }), 404);

  const works = await readCatalog(env);
  const work = works.find((x) => x && (
    (note.id && x.id === note.id) || (x.title === note.title)
  ));
  if (!work) return htmlResponse(page({
    lang: lang,
    title: t.notFound + ' — ' + t.site,
    desc: t.notFoundBody,
    url: SITE + introHome(lang),
    body: '<h1>' + t.notFound + '</h1>'
        + '<p>' + t.notPublished + '</p>'
        + '<p class="foot"><a href="' + introHome(lang) + '">' + t.toList + '</a></p>',
  }), 404);

  const title = pick(note, 'title', lang) || note.title;
  const author = pick(note, 'author', lang) || note.author || work.author || '';
  const lead = pick(note, 'lead', lang);
  const urls = introUrls(note.slug);
  const both = hasBoth(note);

  const facts = [];
  if (note.year) facts.push(htmlEsc(note.year));
  if (work.charCount) {
    facts.push(t.chars(Number(work.charCount).toLocaleString('en-US')));
  }
  const src = publicSource(note.source);

  let body = '<p class="crumb"><a href="/">' + t.site + '</a> › '
    + '<a href="' + introHome(lang) + '">' + t.intros + '</a> › ' + htmlEsc(title)
    + (both ? '　<a href="' + (lang === 'en' ? urls.ja : urls.en) + '">'
              + t.other + '</a>' : '')
    + '</p>\n'
    + '<h1>' + htmlEsc(title) + '</h1>\n'
    + (author ? '<p class="by">' + htmlEsc(author) + '</p>\n' : '')
    + (facts.length ? '<p class="facts">' + facts.join('　·　') + '</p>\n' : '');

  if (lead) body += '<blockquote><p>' + htmlEsc(lead) + '</p></blockquote>\n';
  body += '<div class="body">\n' + paragraphs(intro) + '\n</div>\n';
  body += '<p class="cta"><a class="btn" href="/viewer.html?work='
        + encodeURIComponent(work.id) + '">' + t.read + '</a></p>\n';
  if (src && lang === 'ja') {
    body += '<p class="src">' + t.source + htmlEsc(src) + t.pd + '</p>\n';
  } else if (lang === 'en') {
    body += '<p class="src">' + t.source + 'Aozora Bunko' + t.pd + '</p>\n';
  }

  // 内部リンク。孤立したページを作らないため、他の紹介へも必ず繋ぐ。
  const others = (await introEntries(env, lang))
    .filter((e) => e.note.slug !== note.slug).slice(0, 5);
  if (others.length) {
    body += '<div class="more"><h2>' + t.others + '</h2><ul>\n';
    for (const o of others) {
      const ot = pick(o.note, 'title', lang) || o.note.title;
      const oa = pick(o.note, 'author', lang) || o.note.author || '';
      body += '<li><a href="' + introHome(lang) + htmlEsc(o.note.slug) + '">'
            + htmlEsc(ot) + '</a>'
            + (oa ? (lang === 'en' ? ' (' + htmlEsc(oa) + ')'
                                   : '（' + htmlEsc(oa) + '）') : '')
            + '</li>\n';
    }
    body += '</ul></div>\n';
  }
  body += '<p class="foot"><a href="' + introHome(lang) + '">' + t.toList + '</a>　'
        + '<a href="/">' + t.toTop + '</a></p>';

  const opts = {
    lang: lang,
    title: title + (lang === 'en' ? ' | ' : '｜') + author
         + (lang === 'en' ? ' | ' : '｜') + t.site,
    desc: intro.replace(/\s+/g, ' ').slice(0, 120),
    url: urls[lang],
    ogType: 'article',
    body: body,
  };
  if (both) { opts.altJa = urls.ja; opts.altEn = urls.en; }
  return htmlResponse(page(opts));
}

/* =====================================================================
 * 英語圏に向けた入口  /en/ と /en/authors
 * =====================================================================
 * 2026-10-18 追加。
 *
 * なぜ要るのか
 *   作品の英訳も、英語の作品紹介 (/en/works/) もあるのに、英語のトップが
 *   無かった。サイトの言語切替は localStorage なので、英語圏の人が
 *   aninovel.com を開いても日本語のページが出る。つまり
 *   「英語で検索 → 着地 → 読めずに離脱」という道しか無かった。
 *
 *   /en/ を置くと、英語の紹介ページ群に親ができる。検索エンジンから見て
 *   「英語版のあるサイト」になり、hreflang も日英で対になる。
 *
 * 中身について
 *   日本語トップの直訳にはしない。英語で探している人が知りたいのは
 *   「何が読めるのか」と「なぜ他と違うのか」なので、そこを先に書く。
 *   日本語学習者にも効くはずなので、その一文も入れてある。
 */

async function enHomePage(env) {
  const t = UI.en;
  const entries = await introEntries(env, 'en');

  let list = '';
  for (const { note } of entries) {
    const title = pick(note, 'title', 'en') || note.title;
    const author = pick(note, 'author', 'en') || note.author || '';
    list += '<li><a href="/en/works/' + htmlEsc(note.slug) + '">'
          + htmlEsc(title) + '</a>'
          + (author ? ' <span class="by">' + htmlEsc(author) + '</span>' : '')
          + '</li>\n';
  }

  const body =
      '<p class="crumb">AniNovel　<a href="/">日本語</a></p>\n'
    + '<h1>Japanese classics, read in speech bubbles</h1>\n'
    + '<p class="lead">AniNovel shows a novel the way an anime would: every '
    + 'line of dialogue in its own speech bubble, with a face and a colour for '
    + 'the character who says it. Each character can be read aloud in a voice '
    + 'of their own, and their mouths move while they speak.</p>\n'
    + '<div class="body">\n'
    + '<p>Open <em>I Am a Cat</em> anywhere else and the long conversations '
    + 'blur together — Kushami, Meitei and Kangetsu all arguing, and no way to '
    + 'tell who is talking. That is the problem this site was built to solve.</p>\n'
    + '<p>Everything here is out of copyright. Read up to five works a day '
    + 'without an account.</p>\n'
    + '<p>If you are learning Japanese, the same page can be read in either '
    + 'language, and hearing a line in one character’s voice while seeing '
    + 'who says it makes the dialogue far easier to follow.</p>\n'
    + '</div>\n';

  const works = entries.length
    ? '<div class="more"><h2>What you can read</h2><ul class="plain">\n'
      + list + '</ul>\n'
      + '<p><a href="/en/works/">All introductions</a></p></div>\n'
    : '';

  const writers =
      '<div class="more"><h2>Writing your own</h2>\n'
    + '<p>AniNovel also publishes original fiction. The editor, the character '
    + 'art and the narration are free to use, and part of what the site earns '
    + 'is shared with writers according to how much their work is read.</p>\n'
    + '<p><a href="/en/authors">For writers</a></p></div>\n'
    + '<p class="foot"><a href="/">日本語のトップページ</a></p>';

  return htmlResponse(page({
    lang: 'en',
    title: 'AniNovel | Japanese classics read in anime-style speech bubbles',
    desc: 'Read Soseki, Miyazawa, Akutagawa and other Japanese classics with '
        + 'anime-style speech bubbles and a separate reading voice for every '
        + 'character. Free, no account needed.',
    url: SITE + '/en/',
    altJa: SITE + '/', altEn: SITE + '/en/',
    body: body + works + writers,
  }));
}

function enAuthorsPage() {
  const body =
      '<p class="crumb"><a href="/en/">AniNovel</a> › For writers'
    + '　<a href="/authors.html">日本語</a></p>\n'
    + '<h1>For writers</h1>\n'
    + '<p class="lead">Have your story read with speech bubbles and voices.</p>\n'
    + '<div class="body">\n'
    + '<p><strong>Speech bubbles.</strong> Assign a speaker to each line and it '
    + 'appears in an anime-style bubble, with that character’s icon and colour.</p>\n'
    + '<p><strong>Faces and voices.</strong> Give each character an icon and a '
    + 'reading voice. Their mouths move with the speech.</p>\n'
    + '<p><strong>Read in Japanese too.</strong> Readers can switch languages on '
    + 'the same page.</p>\n'
    + '<p><strong>The tools are free.</strong> The editor, the character art and '
    + 'the narration cost nothing, and there is no monthly fee for writers '
    + 'during the campaign period.</p>\n'
    + '<p><strong>You share in what the site earns.</strong> Part of the revenue '
    + 'is passed on according to how much your work was read. One point is not '
    + 'one yen: what a point is worth changes from period to period, and the '
    + 'full calculation is published.</p>\n'
    + '<p><strong>Your work stays yours.</strong> The operator never takes over '
    + 'your copyright and never sells it on. Unpublish whenever you like and no '
    + 'new use is made of it.</p>\n'
    + '</div>\n'
    + '<div class="more"><h2>Before you write to us</h2>\n'
    + '<p>The site is run from Japan and the editorial correspondence is in '
    + 'Japanese. Write to us in English if that is easier for you — we will '
    + 'manage — but reviews and notices may reach you in Japanese.</p></div>\n'
    + '<p class="cta"><a class="btn" href="/author-apply.html">Apply to become a writer</a></p>\n'
    + '<p class="foot"><a href="/en/">English home</a>　'
    + '<a href="/legal/revenue.html">How the revenue share is calculated</a></p>';

  return htmlResponse(page({
    lang: 'en',
    title: 'For writers | AniNovel',
    desc: 'Publish your fiction with anime-style speech bubbles and a voice for '
        + 'every character. The tools are free, and part of what the site earns '
        + 'is shared according to how much your work is read.',
    url: SITE + '/en/authors',
    altJa: SITE + '/authors.html', altEn: SITE + '/en/authors',
    body: body,
  }));
}
