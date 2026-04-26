#!/usr/bin/env node
/**
 * OGP画像生成スクリプト
 *
 * 機能:
 *   - data/works/*.json を読んで、各作品の OGP 用 SVG を生成
 *   - data/catalog.json から作品一覧を取得
 *   - 出力: data/ogp/{workId}.svg
 *   - PNG化は npx convert-svg-to-png または別途 ImageMagick で:
 *       npx --yes convert-svg-to-png "data/ogp/*.svg"
 *     もしくは Cloudflare Pages の Image Resizing で動的変換も可
 *
 * 使い方:
 *   node scripts/build-ogp.mjs            # 全作品
 *   node scripts/build-ogp.mjs <workId>   # 特定作品のみ
 *
 * 同梱作品 + 投稿作品の両方に対応。
 * 投稿作品はサーバ移行後 Edge Function で動的生成に切替予定。
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CATALOG = path.join(ROOT, 'data', 'catalog.json');
const OGP_DIR = path.join(ROOT, 'data', 'ogp');

const W = 1200, H = 630;

function escXml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function wrapText(text, maxChars){
  const lines = [];
  let cur = '';
  for (const c of String(text||'')) {
    if (c === '\n') { lines.push(cur); cur = ''; continue; }
    cur += c;
    if ([...cur].length >= maxChars) { lines.push(cur); cur = ''; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildSvg({title, author, summary, accentColor, charImageDataUrl}){
  const accent = accentColor || '#C0392B';
  const titleLines = wrapText(title, 16).slice(0, 2);
  const summaryLines = wrapText(summary || '', 32).slice(0, 3);

  let titleY = 230;
  const titleSvg = titleLines.map((l,i)=>`<text x="80" y="${titleY + i*88}" font-family="'Noto Serif JP',serif" font-size="76" font-weight="700" fill="#FAF6F0" letter-spacing="4">${escXml(l)}</text>`).join('\n');

  const summaryY = titleY + titleLines.length * 88 + 30;
  const summarySvg = summaryLines.map((l,i)=>`<text x="80" y="${summaryY + i*36}" font-family="'Noto Sans JP',sans-serif" font-size="22" fill="#FAF6F0" opacity="0.8">${escXml(l)}</text>`).join('\n');

  const charImg = charImageDataUrl
    ? `<clipPath id="charClip"><circle cx="980" cy="315" r="180"/></clipPath>
       <image href="${charImageDataUrl}" x="800" y="135" width="360" height="360" preserveAspectRatio="xMidYMid slice" clip-path="url(#charClip)"/>
       <circle cx="980" cy="315" r="180" fill="none" stroke="${accent}" stroke-width="6"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2D2A26"/>
      <stop offset="55%" stop-color="#4A3728"/>
      <stop offset="100%" stop-color="#6B4423"/>
    </linearGradient>
    <pattern id="dots" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M30 0L60 30L30 60L0 30z" fill="none" stroke="#ffffff" stroke-width="0.4" opacity="0.05"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <text x="${W-40}" y="320" font-family="serif" font-size="380" font-weight="700" fill="#ffffff" opacity="0.04" text-anchor="end" writing-mode="tb">物語</text>
  <text x="80" y="120" font-family="'Noto Serif JP',serif" font-size="22" fill="${accent}" font-weight="700" letter-spacing="6">アニノベル</text>
  <line x1="80" y1="140" x2="220" y2="140" stroke="${accent}" stroke-width="2"/>
  ${titleSvg}
  ${summarySvg}
  ${author ? `<text x="80" y="${H-60}" font-family="'Noto Sans JP',sans-serif" font-size="20" fill="#FAF6F0" opacity="0.6">作: ${escXml(author)}</text>` : ''}
  ${charImg}
</svg>
`;
}

async function readJsonSafe(p){try{return JSON.parse(await fs.readFile(p,'utf8'));}catch{return null;}}

async function buildForWork(entry){
  const json = await readJsonSafe(path.join(ROOT, entry.contentUrl));
  if (!json) { console.warn(`  ⚠ シナリオ読込失敗: ${entry.id}`); return; }
  const title = json.novel?.title || entry.title || entry.id;
  const author = json.novel?.author || entry.author || '';
  const summary = json.novel?.summary || entry.summary || '';
  // 主役キャラ(narrator以外で最初)のアイコン色
  const mainChar = (json.characters||[]).find(c => c.id !== 'narrator');
  const accent = mainChar?.iconColor || '#C0392B';
  const charImg = mainChar?.iconImage || null;

  const svg = buildSvg({title, author, summary, accentColor: accent, charImageDataUrl: charImg});
  const out = path.join(OGP_DIR, entry.id + '.svg');
  await fs.writeFile(out, svg, 'utf8');
  console.log(`  ✓ ${entry.id}.svg (${(svg.length/1024).toFixed(1)}KB)`);
}

async function main(){
  await fs.mkdir(OGP_DIR, { recursive: true });
  const catalog = await readJsonSafe(CATALOG);
  if (!catalog) { console.error('catalog.json が読めません'); process.exit(1); }

  const filterId = process.argv[2];
  const targets = filterId ? catalog.works.filter(w => w.id === filterId) : catalog.works;
  if (!targets.length) { console.error('対象作品なし'); process.exit(1); }

  console.log(`\nOGP生成: ${targets.length}作品 → ${path.relative(ROOT, OGP_DIR)}/\n`);
  for (const w of targets) {
    console.log(`=== ${w.title} (${w.id}) ===`);
    await buildForWork(w);
  }
  console.log(`\n完了。`);
  console.log(`PNG化が必要な場合:`);
  console.log(`  npx --yes convert-svg-to-png "data/ogp/*.svg"  # node-canvasベース`);
  console.log(`または Cloudflare Pages の Image Resizing/Transformations で動的にPNG化(推奨)。`);
}

main().catch(e => { console.error('エラー:', e); process.exit(1); });
