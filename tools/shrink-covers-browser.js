// 表紙を軽くする（ブラウザのコンソールで実行）
//
// このファイルの先頭にブロックコメント（スラッシュと星印）を置いていない。
// 貼り付けの途中で最初の数文字が欠けると、コメントの閉じ側だけが残って
// 「Unexpected token '*'」で丸ごと動かなくなるため。行コメントだけにしてある。
//
// なぜブラウザで動かすのか
//   ログインの証 an_sess は HttpOnly で発行しているので JavaScript からは読めない。
//   これは安全のための正しい作り。ブラウザの中で動かせば、ログイン済みのまま
//   送れるので、証を取り出す必要がそもそも無い。npm も要らない。
//
// 実測（走れメロスの表紙）
//   元 1024x1536 PNG 3.41MB … 大きさは適切で、重いのは PNG だから
//   1024px JPEG q0.82 → 408KB（88%減）  ← 既定。見た目を変えずに一番効く
//   1024px JPEG q0.75 → 325KB（91%減）
//    800px JPEG q0.82 → 234KB（93%減）
//   全15作品で 53.4MB → 6.4MB（88%減）を実サイトで確認済み。
//
// 使い方
//   1. https://aninovel.com にオーナーでログイン
//   2. F12 → Console
//   3. このファイルの中身を全部貼って Enter
//   4. shrinkCovers()              … 確認のみ。1件も書き換えない
//      shrinkCovers({backup:true}) … 元画像を手元に保存（先にこれを推奨）
//      shrinkCovers({apply:true})  … 実際に入れ直す
//
// デプロイ済みなら、貼り付けの代わりに次の1行でも読み込める。
//   await fetch('/tools/shrink-covers-browser.js').then(r=>r.text()).then(eval)

window.shrinkCovers = async function (o) {
  o = Object.assign({
    apply: false,      // true で実際に入れ直す
    backup: false,     // true で元画像をダウンロード
    maxWidth: 1024,    // これより横幅が大きい画像だけ縮める
    quality: 0.82,
    type: 'image/jpeg',
  }, o || {});

  const KB = n => Math.round(n / 1024) + 'KB';
  const MB = n => (n / 1048576).toFixed(2) + 'MB';

  // 表紙の置き場所は作品IDと一致するとは限らない。
  // 昔 my_ で作って pub_ で公開した作品は、表紙が my_ 側に残っている。
  // カタログの coverImage が本当の置き場所なので、そこから取る。
  const cid = w => {
    const m = String(w.coverImage || '').match(/\/api\/cover\/([^?#/]+)/);
    return m ? decodeURIComponent(m[1]) : w.id;
  };

  console.log(o.apply ? '=== 入れ直します ===' :
              o.backup ? '=== 元画像を保存します ===' : '=== 確認のみ（何も変えません）===');

  const cat = await (await fetch('/api/catalog?cb=' + Date.now(), { cache: 'no-store' })).json();
  const works = (cat.works || []).filter(w => w && w.id && w.coverImage);
  console.log('表紙のある作品:', works.length, '件');

  let before = 0, after = 0, done = 0, skip = 0, ng = 0;
  const rows = [];

  for (const w of works) {
    const name = w.title || w.id;
    const id = cid(w);
    try {
      const r = await fetch('/api/cover/' + encodeURIComponent(id) + '?raw=1', { cache: 'no-store' });
      if (!r.ok) { console.warn('取得できません', name, r.status); ng++; continue; }
      const src = await r.blob();
      before += src.size;

      if (o.backup) {
        // 入れ直す前に、元のままを手元へ保存しておく
        const a = document.createElement('a');
        a.href = URL.createObjectURL(src);
        a.download = id + '.orig.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        await new Promise(s => setTimeout(s, 300));   // 連続ダウンロードを詰めすぎない
      }

      const bmp = await createImageBitmap(src);
      const s = Math.min(1, o.maxWidth / bmp.width);
      const cw = Math.round(bmp.width * s), ch = Math.round(bmp.height * s);
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d', { alpha: false }).drawImage(bmp, 0, 0, cw, ch);
      const out = await new Promise(res => cv.toBlob(res, o.type, o.quality));
      bmp.close && bmp.close();

      if (!out || out.size >= src.size) {
        rows.push({ 作品: name, 元: MB(src.size), 後: '—', 結果: '縮まないので触りません' });
        after += src.size; skip++; continue;
      }

      rows.push({ 作品: name, 元: MB(src.size), 後: KB(out.size),
                  削減: Math.round((1 - out.size / src.size) * 100) + '%' });
      after += out.size;

      if (!o.apply) { done++; continue; }

      // 入れ直す先も、取ってきたのと同じ場所にする。
      // 別の場所へ入れると、カタログの coverImage が古いほうを指したままになる。
      const put = await fetch('/api/cover/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': o.type },
        credentials: 'same-origin',      // ログインの証は自動で付く
        body: out,
      });
      if (!put.ok) {
        let msg = ''; try { msg = (await put.json()).message || ''; } catch (e) {}
        console.error('入れ直し失敗', name, put.status, msg);
        ng++; continue;
      }
      done++;
    } catch (e) {
      console.error('エラー', name, e && e.message);
      ng++;
    }
  }

  console.table(rows);
  console.log('合計  前:', MB(before), ' 後:', MB(after),
    before ? '(' + Math.round((1 - after / before) * 100) + '% 減)' : '');
  console.log((o.apply ? '入れ直し:' : '対象:'), done, '件 / 触らず:', skip, '件 / 失敗:', ng, '件');
  if (!o.apply) console.log('実際に入れ直すには  shrinkCovers({apply:true})');
  return { before, after, done, skip, ng };
};

console.log('用意できました。次のどれかを実行してください:');
console.log('  shrinkCovers()                … 確認のみ');
console.log('  shrinkCovers({backup:true})   … 元画像を保存');
console.log('  shrinkCovers({apply:true})    … 入れ直す');
