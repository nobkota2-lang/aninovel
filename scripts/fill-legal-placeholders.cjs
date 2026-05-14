#!/usr/bin/env node
/**
 * アニノベル 法務ページ プレースホルダ置換スクリプト
 *
 * 配置: scripts/fill-legal-placeholders.cjs
 * 実行:
 *   node scripts/fill-legal-placeholders.cjs          # 対話入力
 *   node scripts/fill-legal-placeholders.cjs --check  # 残プレースホルダ確認のみ
 *   node scripts/fill-legal-placeholders.cjs --config legal.config.json
 *
 * 処理対象:
 *   legal/terms.html
 *   legal/privacy.html
 *   legal/tokushoho.html
 *   legal/dmca.html
 *   legal/accessibility.html
 *
 * 置換対象 (例):
 *   [YYYY年MM月DD日]   → 設定の制定日 / 改定日
 *   [YYYY]            → 設定の年
 *   [運営者名 / 屋号]   → 運営者名
 *   [運営者名]         → 運営者名
 *   [管理者名]         → 個人情報保護管理者名
 *   [contact@example.com] → contactEmail
 *   [privacy@example.com] → privacyEmail
 *   [copyright@example.com] → copyrightEmail
 *   [accessibility@example.com] → a11yEmail
 *   [東京地方裁判所]    → 管轄裁判所
 *   [Cloudflare Pages / Vercel 等] → cdnProvider
 *   [Supabase / Firebase 等] → authProvider
 *   ...
 */

'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LEGAL_DIR = path.resolve(__dirname, '..', 'legal');
const FILES = ['terms.html', 'privacy.html', 'tokushoho.html', 'dmca.html', 'accessibility.html'];

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const configIdx = args.indexOf('--config');
const configPath = configIdx >= 0 ? args[configIdx + 1] : null;

main().catch(e => { console.error(e); process.exit(1); });

async function main() {
  // ===== チェックモード =====
  if (checkOnly) {
    return checkPlaceholders();
  }

  // ===== 設定取得 =====
  let cfg;
  if (configPath && fs.existsSync(configPath)) {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log(`📄 設定: ${configPath}`);
  } else {
    cfg = await promptConfig();
  }

  // ===== 置換マップ生成 =====
  const today = cfg.effectiveDate || new Date().toISOString().slice(0, 10).replace(/-/g, '年').replace('年', '年').replace(/年(\d{2})/, '年$1月').replace(/月(\d{2})$/, '月$1日');
  const todayStr = formatJaDate(cfg.effectiveDate || new Date());
  const year = todayStr.split('年')[0];

  const replaceMap = [
    // 日付
    { from: /\[YYYY年MM月DD日\]/g, to: todayStr },
    { from: /\[YYYY\]/g, to: year },
    // 主体
    { from: /\[運営者名 \/ 屋号\]/g, to: cfg.ownerName },
    { from: /\[運営者名\]/g, to: cfg.ownerName },
    { from: /\[管理者名\]/g, to: cfg.privacyManager || cfg.ownerName },
    // 連絡先
    { from: /\[contact@example\.com\]/g, to: cfg.contactEmail },
    { from: /\[privacy@example\.com\]/g, to: cfg.privacyEmail || cfg.contactEmail },
    { from: /\[copyright@example\.com\]/g, to: cfg.copyrightEmail || cfg.contactEmail },
    { from: /\[accessibility@example\.com\]/g, to: cfg.a11yEmail || cfg.contactEmail },
    // 場所
    { from: /\[東京地方裁判所\]/g, to: cfg.courtVenue || '東京地方裁判所' },
    // 利用サービス
    { from: /\[Cloudflare Pages \/ Vercel 等\]/g, to: cfg.cdnProvider || 'Cloudflare Pages' },
    { from: /\[Supabase \/ Firebase 等\]/g, to: cfg.authProvider || 'Cloudflare D1 / Workers' },
    { from: /\[Google Analytics 4 \/ Plausible 等\]/g, to: cfg.analyticsProvider || 'Google Analytics 4 / Cloudflare Web Analytics' },
    { from: /\[Google AdSense 等\]/g, to: cfg.adProvider || 'Google AdSense' },
    { from: /\[Stripe 等\]/g, to: cfg.paymentProvider || 'Stripe' },
    { from: /\[SendGrid \/ Resend 等\]/g, to: cfg.mailProvider || 'Resend' },
    // ドメイン
    { from: /https:\/\/example\.com\//g, to: cfg.siteUrl ? cfg.siteUrl.replace(/\/+$/, '') + '/' : 'https://aninovel.com/' },
    { from: /\[https:\/\/example\.com\]/g, to: cfg.siteUrl || 'https://aninovel.com' },
    { from: /\[作品名等\]/g, to: '[作品名]' },  // 通報メール件名のサンプル、これは残してOK
    // 特商法固有
    { from: /\[運営者氏名 \/ 法人名\]/g, to: cfg.legalEntityName || cfg.ownerName },
    { from: /\[氏名\]/g, to: cfg.representativeName || cfg.ownerName },
    { from: /\[〒XXX-XXXX 都道府県市区町村番地建物名\]/g, to: cfg.address || '請求があった場合に遅滞なく開示します' },
    { from: /\[03-XXXX-XXXX\]/g, to: cfg.phone || '請求があった場合に遅滞なく開示します' },
    { from: /\[support@example\.com\]/g, to: cfg.supportEmail || cfg.contactEmail },
    { from: /\[その他の決済手段があれば追記\]/g, to: cfg.additionalPaymentMethods || '' },
    { from: /\[XXX\]/g, to: cfg.misc || '別途定める' },
  ];

  // ===== 各ファイルを処理 =====
  console.log('\n📝 法務ページのプレースホルダを置換中...\n');

  let totalReplaced = 0;
  for (const fname of FILES) {
    const filePath = path.join(LEGAL_DIR, fname);
    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠ ${fname}: ファイルなし、スキップ`);
      continue;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    let replacedHere = 0;
    for (const r of replaceMap) {
      const matches = content.match(r.from);
      if (matches) {
        content = content.replace(r.from, r.to);
        replacedHere += matches.length;
      }
    }
    // バックアップを作成
    const backupPath = filePath + '.backup-' + Date.now();
    fs.copyFileSync(filePath, backupPath);
    fs.writeFileSync(filePath, content);
    console.log(`  ✓ ${fname}: ${replacedHere}件置換 (backup: ${path.basename(backupPath)})`);
    totalReplaced += replacedHere;
  }

  console.log(`\n✅ 完了: ${totalReplaced}件のプレースホルダを置換しました\n`);

  // ===== 残プレースホルダ確認 =====
  checkPlaceholders();

  // ===== 設定をファイルに保存 (再利用可能に) =====
  if (!configPath) {
    const savedPath = path.resolve(__dirname, '..', 'legal.config.json');
    fs.writeFileSync(savedPath, JSON.stringify(cfg, null, 2));
    console.log(`💾 設定を保存: ${savedPath}`);
    console.log(`   次回からは: node scripts/fill-legal-placeholders.cjs --config legal.config.json`);
  }
}

function checkPlaceholders() {
  console.log('🔍 残プレースホルダをチェック中...\n');
  let foundAny = false;
  for (const fname of FILES) {
    const filePath = path.join(LEGAL_DIR, fname);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    // 残ったプレースホルダ風記述を検出
    const matches = [...content.matchAll(/(class="placeholder">|>)\[([^\]]+)\]/g)];
    if (matches.length > 0) {
      foundAny = true;
      console.log(`  ⚠ ${fname}: ${matches.length}件の未置換プレースホルダ`);
      const unique = [...new Set(matches.map(m => '[' + m[2] + ']'))];
      unique.slice(0, 5).forEach(p => console.log(`     - ${p}`));
      if (unique.length > 5) console.log(`     ...他 ${unique.length - 5}種`);
    } else {
      console.log(`  ✓ ${fname}: クリーン`);
    }
  }
  if (!foundAny) {
    console.log('\n✅ すべての法務ページでプレースホルダは置換済みです\n');
  } else {
    console.log('\n⚠ 上記のプレースホルダは手動で置換するか、スクリプト側に追加してください\n');
    if (checkOnly) process.exit(1);
  }
}

async function promptConfig() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q, def) => new Promise(res => rl.question(`${q}${def ? ` [${def}]` : ''}: `, a => res(a.trim() || def || '')));

  console.log('\n📋 法務ページに記載する事業者情報を入力してください。\n   (Enterでデフォルト値を使用、後で修正可能)\n');
  const cfg = {};
  cfg.ownerName       = await ask('運営者名 / 屋号', 'アニノベル運営チーム');
  cfg.legalEntityName = await ask('法人名 (個人事業の場合は屋号)', cfg.ownerName);
  cfg.representativeName = await ask('代表者氏名 (特商法表記用)', '');
  cfg.address         = await ask('所在地 (特商法表記用、空ならば「請求があった場合に開示」)', '');
  cfg.phone           = await ask('連絡先電話 (空ならば「請求があった場合に開示」)', '');
  cfg.privacyManager  = await ask('個人情報保護管理者氏名', cfg.representativeName || cfg.ownerName);
  cfg.contactEmail    = await ask('一般お問い合わせメール', 'contact@aninovel.com');
  cfg.supportEmail    = await ask('サポートメール', cfg.contactEmail);
  cfg.privacyEmail    = await ask('プライバシー担当メール', cfg.contactEmail);
  cfg.copyrightEmail  = await ask('著作権窓口メール', cfg.contactEmail);
  cfg.a11yEmail       = await ask('アクセシビリティ担当メール', cfg.contactEmail);
  cfg.courtVenue      = await ask('紛争時の管轄裁判所', '東京地方裁判所');
  cfg.siteUrl         = await ask('本番サイトURL', 'https://aninovel.com');
  cfg.cdnProvider     = await ask('ホスティング・CDN', 'Cloudflare Pages');
  cfg.authProvider    = await ask('データベース・認証', 'Cloudflare D1 / Workers');
  cfg.analyticsProvider = await ask('アクセス解析', 'Google Analytics 4 / Cloudflare Web Analytics');
  cfg.adProvider      = await ask('広告配信', 'Google AdSense');
  cfg.paymentProvider = await ask('決済', 'Stripe');
  cfg.mailProvider    = await ask('メール配信', 'Resend');
  cfg.effectiveDate   = await ask('施行日 (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));

  rl.close();
  return cfg;
}

function formatJaDate(d) {
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}年${m}月${dd}日`;
  }
  // YYYY-MM-DD 文字列
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}年${m[2]}月${m[3]}日`;
  return String(d);
}
