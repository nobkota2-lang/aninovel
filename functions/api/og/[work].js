/**
 * アニノベル 動的OGP画像生成 API
 * GET /api/og/[work].svg
 *
 * 例:
 *   /api/og/mystery-garden.svg
 *   /api/og/starlight-cafe.svg
 *
 * 用途:
 *   各作品ページの og:image にこのURLを指定すると、
 *   作品ごとに動的にOGP画像を生成 (タイトル/著者/統計を反映)。
 *   → SNSシェア時の見栄えとCTRが桁違いに上がる。
 *
 * 出力:
 *   SVG (1200×630, OGP標準サイズ)
 *
 * 注意:
 *   一部SNS (古いLINE等) はSVGをサポートしない可能性がある。
 *   完璧を期すなら resvg や satori でPNG化するが、Workersのバンドル制限的に
 *   SVGをCloudflareのImage Resizing経由で配信するのが現実的。
 *
 * Image Resizing 利用 (有料、$5/月で500万リクエスト):
 *   <meta property="og:image" content="/cdn-cgi/image/format=png,width=1200,height=630/api/og/mystery-garden.svg">
 *
 * 必要: なし (静的JSON参照のみ)
 */

export async function onRequest(context) {
  const { params, request, env } = context;
  const workId = (params.work || '').replace(/\.(svg|png|jpg|jpeg)$/i, '');

  // 作品データ取得 (data/works/{id}.json)
  let work = null;
  try {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const r = await fetch(`${origin}/data/works/${encodeURIComponent(workId)}.json`);
    if (r.ok) work = await r.json();
  } catch (e) {}

  if (!work) {
    // 作品が見つからない場合はデフォルトOGPを返す
    return svgResponse(buildDefaultOGP());
  }

  return svgResponse(buildOGP(work));
}

// ===== SVG生成 =====

function buildOGP(work) {
  const title = (work.title || '無題').slice(0, 30);
  const author = (work.author || '匿名').slice(0, 24);
  const desc = (work.description || work.summary || '').slice(0, 80);
  const charCount = work.totalChars || work.charCount || 0;
  const pageCount = work.totalPages || work.pageCount || 0;

  // タイトルが長い場合の改行 (10文字毎)
  const titleLines = wrapText(title, 14);
  const titleFontSize = titleLines.length > 1 ? 60 : 72;

  // ランダム背景バリエーション (作品IDからシード)
  const variant = hashSeed(work.id || work.workId || title) % 5;
  const themes = [
    { bg: '#2D2A26', accent: '#C0392B', light: '#FFB39B', sub: '#FAF6F0' },  // ノクターン
    { bg: '#1B3A4B', accent: '#FF9F1C', light: '#FFD7A8', sub: '#FAF6F0' },  // 黄昏
    { bg: '#2E2B3D', accent: '#9D71BB', light: '#D4B5E8', sub: '#F2EFF7' },  // 紫煙
    { bg: '#1F3D2B', accent: '#52B788', light: '#B7E4C7', sub: '#F2FAF5' },  // 翠
    { bg: '#3D2A2A', accent: '#E07A5F', light: '#F2CC8F', sub: '#FAF6F0' },  // 茜
  ];
  const t = themes[variant];

  const stats = [];
  if (pageCount > 0) stats.push(`📖 ${pageCount}ページ`);
  if (charCount > 0) stats.push(`📝 ${formatNum(charCount)}文字`);
  if (work.totalVotes > 0) stats.push(`❤ ${work.totalVotes}票`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${t.bg}"/>
      <stop offset="100%" stop-color="${darken(t.bg, 0.4)}"/>
    </linearGradient>
    <radialGradient id="glow" cx="20%" cy="30%" r="40%">
      <stop offset="0%" stop-color="${t.accent}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${t.accent}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="20" r="1.5" fill="${t.sub}" fill-opacity="0.08"/>
    </pattern>
  </defs>

  <!-- 背景 -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#dots)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- 装飾的な縦線 (左) -->
  <rect x="80" y="120" width="3" height="390" fill="${t.accent}" opacity="0.9"/>
  <rect x="92" y="160" width="1" height="310" fill="${t.light}" opacity="0.4"/>

  <!-- ブランド名 (左上) -->
  <text x="120" y="100" font-family="'Hiragino Sans','Yu Gothic',sans-serif" font-size="22" font-weight="600" fill="${t.sub}" opacity="0.7" letter-spacing="0.3em">アニノベル</text>
  <text x="120" y="124" font-family="'Hiragino Sans',sans-serif" font-size="11" fill="${t.light}" opacity="0.7" letter-spacing="0.5em">ANINOVEL</text>

  <!-- タイトル -->
  ${titleLines.map((line, i) => `
  <text x="120" y="${250 + i * (titleFontSize + 8)}" font-family="'Hiragino Mincho ProN','Yu Mincho',serif" font-size="${titleFontSize}" font-weight="700" fill="${t.sub}">${escapeXml(line)}</text>
  `).join('')}

  <!-- 著者 -->
  <text x="120" y="${250 + titleLines.length * (titleFontSize + 8) + 24}" font-family="'Hiragino Sans',sans-serif" font-size="22" fill="${t.light}" opacity="0.9">作者: ${escapeXml(author)}</text>

  <!-- 説明 (任意) -->
  ${desc ? `
  <text x="120" y="${250 + titleLines.length * (titleFontSize + 8) + 64}" font-family="'Hiragino Mincho ProN',serif" font-size="20" fill="${t.sub}" opacity="0.65" font-style="italic">${escapeXml(wrapText(desc, 36)[0])}</text>
  ` : ''}

  <!-- 統計 (右下) -->
  ${stats.length > 0 ? `
  <g transform="translate(120, 530)">
    <rect x="0" y="0" width="${stats.length * 200}" height="48" rx="24" fill="${t.bg}" stroke="${t.accent}" stroke-width="2" stroke-opacity="0.4"/>
    ${stats.map((s, i) => `
    <text x="${i * 200 + 20}" y="32" font-family="'Hiragino Sans',sans-serif" font-size="18" fill="${t.sub}" opacity="0.95">${escapeXml(s)}</text>
    `).join('')}
  </g>
  ` : ''}

  <!-- 装飾: 右上の円 -->
  <circle cx="1050" cy="120" r="70" fill="none" stroke="${t.accent}" stroke-width="2" opacity="0.3"/>
  <circle cx="1050" cy="120" r="50" fill="none" stroke="${t.light}" stroke-width="1" opacity="0.4"/>
  <text x="1050" y="128" font-family="'Hiragino Mincho ProN',serif" font-size="32" fill="${t.accent}" text-anchor="middle" opacity="0.9">物</text>

  <!-- 装飾: 右下の漢字 -->
  <text x="1080" y="580" font-family="'Hiragino Mincho ProN',serif" font-size="120" fill="${t.accent}" opacity="0.08" text-anchor="end">語</text>

  <!-- URL -->
  <text x="120" y="600" font-family="'Hiragino Sans',sans-serif" font-size="14" fill="${t.light}" opacity="0.6" letter-spacing="0.1em">aninovel.com</text>
</svg>`;
}

function buildDefaultOGP() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2D2A26"/>
      <stop offset="100%" stop-color="#1A1815"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="600" y="270" font-family="'Hiragino Sans',sans-serif" font-size="32" fill="#FFB39B" text-anchor="middle" letter-spacing="0.5em">ANINOVEL</text>
  <text x="600" y="360" font-family="'Hiragino Mincho ProN',serif" font-size="88" font-weight="700" fill="#FAF6F0" text-anchor="middle">アニノベル</text>
  <text x="600" y="430" font-family="'Hiragino Sans',sans-serif" font-size="24" fill="#FAF6F0" opacity="0.7" text-anchor="middle">アニメ風吹き出しで読むオリジナル小説</text>
  <line x1="450" y1="500" x2="750" y2="500" stroke="#C0392B" stroke-width="2"/>
  <text x="600" y="560" font-family="'Hiragino Sans',sans-serif" font-size="16" fill="#FFB39B" opacity="0.7" text-anchor="middle" letter-spacing="0.2em">aninovel.com</text>
</svg>`;
}

// ===== Helpers =====

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function wrapText(text, maxLen) {
  // 日本語向けの簡易ラップ (語の境界を見ない、文字数のみ)
  const lines = [];
  let cur = '';
  for (const c of text) {
    cur += c;
    if (cur.length >= maxLen) {
      lines.push(cur);
      cur = '';
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines.slice(0, 3) : [text];
}

function hashSeed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function darken(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 0xff) * (1 - factor)) | 0;
  const g = Math.max(0, ((n >> 8) & 0xff) * (1 - factor)) | 0;
  const b = Math.max(0, (n & 0xff) * (1 - factor)) | 0;
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function formatNum(n) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  if (n >= 1000) return n.toLocaleString();
  return String(n);
}

function svgResponse(svg) {
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      // 検索エンジンに優しく
      'X-Robots-Tag': 'noindex',
    }
  });
}
