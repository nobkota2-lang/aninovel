/**
 * 表紙の画像を適度な大きさに縮小して入れ直す  tools/shrink-covers.mjs
 * ============================================================
 *
 * 何をするか
 *   1. /api/catalog から作品の一覧を取る
 *   2. それぞれの表紙を ?raw=1 で元のまま取ってくる
 *   3. 幅1200px・品質82のJPEGに縮める（元がそれより小さければ触らない）
 *   4. 縮んだものを PUT で入れ直す
 *
 * なぜ 1200px か
 *   画面に出るのは250px前後だが、元画像として残すので余裕を持たせる。
 *   配信時にさらに600pxへ変換がかかるので、ここは「元として十分」で足りる。
 *   3.5MB → だいたい 200〜400KB になる。
 *
 * 安全のために
 *   ・--dry を付けて実行すると、縮めた結果の大きさを表示するだけで入れ直さない
 *   ・縮める前の画像を backup/ に保存する（消える前に手元に残す）
 *   ・元より大きくなってしまった場合は入れ直さない
 *
 * 使い方（お手元のパソコンで）
 *   cd /d E:\aninovel\aninovel
 *   npm install sharp
 *   node tools/shrink-covers.mjs --dry      ← まず確認だけ
 *   node tools/shrink-covers.mjs            ← 実際に入れ直す
 *
 * 認証について
 *   表紙の入れ直しには作者かオーナーのログインが要る。
 *   ブラウザで aninovel.com にログインしてから、開発者ツールの
 *   Console で document.cookie を実行し、an_sess= で始まる部分を
 *   下の SESSION に貼ってください。
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITE = process.env.ANINOVEL_SITE || 'https://aninovel.com';
const SESSION = process.env.ANINOVEL_SESSION || '';   // 例: 'an_sess=xxxxxxxx'
const MAX_WIDTH = 1200;
const QUALITY = 82;
const BACKUP_DIR = 'backup/covers';

const DRY = process.argv.includes('--dry');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  console.error('sharp が見つかりません。先に次を実行してください:');
  console.error('    npm install sharp');
  process.exit(1);
}

function mb(n) { return (n / 1048576).toFixed(2) + 'MB'; }
function kb(n) { return Math.round(n / 1024) + 'KB'; }

async function main() {
  if (!DRY && !SESSION) {
    console.error('入れ直しにはログインが必要です。');
    console.error('環境変数 ANINOVEL_SESSION に an_sess=... を設定してから実行してください。');
    console.error('確認だけなら --dry を付けてください。');
    process.exit(1);
  }

  console.log(DRY ? '=== 確認のみ（入れ直しはしません）===' : '=== 表紙を縮めて入れ直します ===');
  console.log('宛先:', SITE);
  console.log();

  const cat = await (await fetch(SITE + '/api/catalog?cb=' + Date.now())).json();
  const works = (cat.works || []).filter(w => w && w.id && w.coverImage);
  console.log('表紙のある作品:', works.length, '件');
  console.log();

  if (!DRY && !existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  let before = 0, after = 0, done = 0, skipped = 0, failed = 0;

  for (const w of works) {
    const label = (w.title || w.id).slice(0, 22).padEnd(24);
    try {
      // 元のままを取る
      const r = await fetch(SITE + '/api/cover/' + encodeURIComponent(w.id) + '?raw=1');
      if (!r.ok) { console.log(label, '取得できません (' + r.status + ')'); failed++; continue; }
      const src = Buffer.from(await r.arrayBuffer());

      const meta = await sharp(src).metadata();
      const out = await sharp(src)
        .rotate()                                   // 撮影時の向きを正す
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer();

      before += src.length;

      if (out.length >= src.length) {
        console.log(label, mb(src.length), '→ 縮まないので触りません');
        after += src.length; skipped++; continue;
      }

      const pct = Math.round((1 - out.length / src.length) * 100);
      console.log(label, mb(src.length), '→', kb(out.length),
        '(' + pct + '% 減、' + meta.width + 'px → ' + Math.min(meta.width, MAX_WIDTH) + 'px)');
      after += out.length;

      if (DRY) { done++; continue; }

      // 縮める前を手元に残す
      writeFileSync(join(BACKUP_DIR, w.id + '.orig'), src);

      const put = await fetch(SITE + '/api/cover/' + encodeURIComponent(w.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg', 'Cookie': SESSION },
        body: out,
      });
      if (!put.ok) {
        const t = await put.text().catch(() => '');
        console.log('   ★ 入れ直し失敗 (' + put.status + ') ' + t.slice(0, 120));
        failed++; continue;
      }
      done++;
    } catch (e) {
      console.log(label, '★ エラー:', (e && e.message) || e);
      failed++;
    }
  }

  console.log();
  console.log('--------------------------------------------');
  console.log('合計  前:', mb(before), ' 後:', mb(after),
    before ? ' (' + Math.round((1 - after / before) * 100) + '% 減)' : '');
  console.log('入れ直し:', done, '件 / 触らず:', skipped, '件 / 失敗:', failed, '件');
  if (!DRY) console.log('縮める前の画像は', BACKUP_DIR, 'に残してあります。');
}

main().catch(e => { console.error(e); process.exit(1); });
