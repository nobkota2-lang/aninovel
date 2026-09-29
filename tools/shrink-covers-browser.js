/* ============================================================
 * 表紙を軽くする（ブラウザのコンソールで実行）
 *   tools/shrink-covers-browser.js
 * ------------------------------------------------------------
 * なぜブラウザで動かすのか
 *   ログインの証 (an_sess) は HttpOnly で発行しているため、
 *   JavaScript からは読めず、外に持ち出せない。これは安全のための作りで、
 *   正しい挙動。ブラウザの中で動かせば、ログイン済みのまま送れるので、
 *   証を取り出す必要がそもそも無くなる。
 *
 * 実測でわかったこと（走れメロスの表紙で計測）
 *   元は 1024x1536 の PNG で 3.41MB。大きさは適切で、
 *   重いのは PNG で保存されていたから。
 *     1024px JPEG q0.82 →  408KB（88%減）
 *     1024px JPEG q0.75 →  325KB（91%減）
 *      800px JPEG q0.82 →  234KB（93%減）
 *   既定は 1024px / q0.82。表紙の見え方を変えずに一番効く設定。
 *
 * 使い方
 *   1. https://aninovel.com にオーナーでログイン
 *   2. F12 → Console
 *   3. このファイルの中身を貼って Enter
 *   4. shrinkCovers()          … 確認のみ。1件も書き換えない
 *      shrinkCovers({backup:true}) … 元画像を手元に保存（先にこれを推奨）
 *      shrinkCovers({apply:true})  … 実際に入れ直す
 * ============================================================ */

window.shrinkCovers = async function (opts) {
  const o = Object.assign({
    apply: false,      // true で実際に入れ直す
    backup: false,     // true で元画像をダウンロード
    maxWidth: 1024,    // これより横幅が大きい画像だけ縮める
    quality: 0.82,
    type: 'image/jpeg',
  }, opts || {});

  const KB = n => Math.round(n / 1024) + 'KB';
  const MB = n => (n / 1048576).toFixed(2) + 'MB';

  console.log(o.apply ? '=== 入れ直します ===' :
              o.backup ? '=== 元画像を保存します ===' : '=== 確認のみ（何も変えません）===');

  const cat = await (await fetch('/api/catalog?cb=' + Date.now(), { cache: 'no-store' })).json();
  const works = (cat.works || []).filter(w => w && w.id && w.coverImage);
  console.log('表紙のある作品:', works.length, '件\n');

  let before = 0, after = 0, done = 0, skipped = 0, failed = 0;
  const rows = [];

  for (const w of works) {
    const name = (w.title || w.id);
    // 表紙の置き場所は作品IDと一致するとは限らない。
    // 昔 my_ で作って pub_ で公開した作品は、表紙が my_ 側に残っている。
    // カタログの coverImage が本当の置き場所なので、そこから取る。
    const coverId = (function () {
      try {
        const m = String(w.coverImage || '').match(/\/api\/cover\/([^?#/]+)/);
        return m ? decodeURIComponent(m[1]) : w.id;
      } catch (e) { return w.id; }
    })();
    try {
      const res = await fetch('/api/cover/' + encodeURIComponent(coverId) + '?raw=1', { cache: 'no-store' });
      if (!res.ok) { console.warn('取得できません', name, res.status); failed++; continue; }
      const src = await res.blob();
      before += src.size;

      if (o.backup) {
        // 入れ直す前に、元のままを手元へ保存しておく
        const a = document.createElement('a');
        a.href = URL.createObjectURL(src);
        a.download = coverId + '.orig.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        await new Promise(r => setTimeout(r, 300));   // 連続ダウンロードを詰めすぎない
      }

      const bmp = await createImageBitmap(src);
      const scale = Math.min(1, o.maxWidth / bmp.width);
      const cw = Math.round(bmp.width * scale), ch = Math.round(bmp.height * scale);
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d', { alpha: false }).drawImage(bmp, 0, 0, cw, ch);
      const out = await new Promise(r => cv.toBlob(r, o.type, o.quality));
      bmp.close && bmp.close();

      if (!out || out.size >= src.size) {
        rows.push({ 作品: name, 元: MB(src.size), 後: '—', 結果: '縮まないので触りません' });
        after += src.size; skipped++; continue;
      }

      rows.push({ 作品: name, 元: MB(src.size), 後: KB(out.size),
                  削減: Math.round((1 - out.size / src.size) * 100) + '%',
                  寸法: bmp.width + 'px → ' + cw + 'px' });
      after += out.size;

      if (!o.apply) { done++; continue; }

      // 入れ直す先も、取ってきたのと同じ場所にする。
      // 別の場所へ入れると、カタログの coverImage が古いほうを指したままになる。
      const put = await fetch('/api/cover/' + encodeURIComponent(coverId), {
        method: 'PUT',
        headers: { 'Content-Type': o.type },
        credentials: 'same-origin',      // ログインの証は自動で付く
        body: out,
      });
      if (!put.ok) {
        let msg = ''; try { msg = (await put.json()).message || ''; } catch (e) {}
        console.error('★ 入れ直し失敗', name, put.status, msg);
        failed++; continue;
      }
      done++;
    } catch (e) {
      console.error('★ エラー', name, e && e.message);
      failed++;
    }
  }

  console.table(rows);
  console.log('合計  前:', MB(before), ' 後:', MB(after),
    before ? '(' + Math.round((1 - after / before) * 100) + '% 減)' : '');
  console.log((o.apply ? '入れ直し:' : '対象:'), done, '件 / 触らず:', skipped, '件 / 失敗:', failed, '件');
  if (!o.apply) console.log('\n実際に入れ直すには  shrinkCovers({apply:true})');
  return { before, after, done, skipped, failed };
};

console.log('用意できました。次のどれかを実行してください:\n' +
  '  shrinkCovers()                … 確認のみ\n' +
  '  shrinkCovers({backup:true})   … 元画像を保存\n' +
  '  shrinkCovers({apply:true})    … 入れ直す');
