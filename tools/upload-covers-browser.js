// 手元で作った表紙画像を本番へ入れる（ブラウザのコンソールで実行）
//
// なぜブラウザで動かすのか
//   表紙の入れ直しには作者かオーナーのログインが要る。ログインの証 an_sess は
//   HttpOnly で発行しているので JavaScript からは読めない（これは安全のための
//   正しい作り）。ブラウザの中で動かせば、ログイン済みのまま送れる。
//
// なぜ「フォルダに置く」ではないのか
//   表紙はサイトのファイルではなく、R2 という置き場の中にある。
//   入口は PUT /api/cover/{キー} の1つだけ。
//
// いちばん大事な注意
//   入れ先のキーは作品IDではなく、カタログの coverImage に書かれている名前。
//   15作品のうち4作品は、キーが作品IDと違う（my_ のまま残っている）。
//   作品IDのほうへ入れると、保存は成功するのに画面は変わらない。
//   この道具は coverImage から正しいキーを取るので、その事故は起きない。
//
// ファイル名の見分け方（上から順に試す）
//   1. キーそのもの          my_1783235234183.jpg
//   2. 作品ID               pub_1783235234183.jpg     → キーへ読み替える
//   3. 作品の題名            銀河鉄道の夜.jpg
//   .orig や -small のような添え字、拡張子は落としてから比べる。
//
// 使い方
//   1. https://aninovel.com にオーナーでログイン
//   2. F12 → Console
//   3. このファイルの中身を全部貼って Enter
//   4. uploadCovers()             … 選んだファイルの割り当てを見るだけ。入れない
//      uploadCovers({apply:true}) … 実際に入れる
//
//   どちらもファイル選択の窓が開く。まとめて選んでよい。

window.uploadCovers = async function (o) {
  o = Object.assign({
    apply: false,       // true で実際に入れる
    files: null,        // FileList を直接渡したいとき
  }, o || {});

  const KB = n => Math.round(n / 1024) + 'KB';
  const MAXB = 5 * 1024 * 1024;   // サーバー側の上限
  const OK = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  // 拡張子から種類を補う。選び方によっては file.type が空のことがある
  const typeOf = f => {
    if (OK.indexOf(f.type) >= 0) return f.type;
    const e = (f.name.split('.').pop() || '').toLowerCase();
    if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
    if (e === 'png') return 'image/png';
    if (e === 'webp') return 'image/webp';
    if (e === 'gif') return 'image/gif';
    return '';
  };

  // 比べるための素の名前。拡張子と、よくある添え字を落とす
  const bare = s => String(s)
    .replace(/^.*[\\/]/, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[._-](orig|original|small|min|comp|compressed|shrunk|out|new)$/i, '')
    .trim().toLowerCase();

  // カタログの coverImage から本当の入れ先を取る
  const cid = w => {
    const m = String(w.coverImage || '').match(/\/api\/cover\/([^?#/]+)/);
    return m ? decodeURIComponent(m[1]) : w.id;
  };

  // ファイルを選んでもらう
  let files = o.files;
  if (!files) {
    files = await new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file'; i.multiple = true; i.accept = 'image/*';
      i.onchange = () => res(i.files);
      i.click();
    });
  }
  files = Array.from(files || []);
  if (!files.length) { console.log('ファイルが選ばれていません。'); return; }

  const cat = await (await fetch('/api/catalog?cb=' + Date.now(), { cache: 'no-store' })).json();
  const works = (cat.works || []).filter(w => w && w.id && w.coverImage);

  // 照合表を作る
  const byKey = {}, byWorkId = {}, byTitle = {};
  for (const w of works) {
    const k = cid(w);
    byKey[k.toLowerCase()] = k;
    byWorkId[String(w.id).toLowerCase()] = k;
    if (w.title) byTitle[String(w.title).toLowerCase()] = k;
    if (w.titleEn) byTitle[String(w.titleEn).toLowerCase()] = k;
  }

  const rows = [], jobs = [];
  for (const f of files) {
    const b = bare(f.name);
    let key = null, how = '';
    if (byKey[b])         { key = byKey[b];    how = 'キー一致'; }
    else if (byWorkId[b]) { key = byWorkId[b]; how = '作品ID→キーへ読み替え'; }
    else if (byTitle[b])  { key = byTitle[b];  how = '題名一致'; }

    const ct = typeOf(f);
    let ng = '';
    if (!key)               ng = '対応する作品が見つかりません';
    else if (!ct)           ng = '画像として扱えない種類です';
    else if (f.size > MAXB) ng = '5MBを超えています';

    rows.push({ ファイル: f.name, 入れ先: key || '—', 判定: how || '—',
                大きさ: KB(f.size), 結果: ng || (o.apply ? '入れます' : '入れられます') });
    if (!ng) jobs.push({ f: f, key: key, ct: ct });
  }

  console.table(rows);

  if (!o.apply) {
    console.log('確認のみです。実際に入れるには  uploadCovers({apply:true})');
    console.log('入れられる:', jobs.length, '件 / 見送り:', rows.length - jobs.length, '件');
    return { rows: rows, ready: jobs.length };
  }

  let ok = 0, ng = 0;
  for (const j of jobs) {
    try {
      const res = await fetch('/api/cover/' + encodeURIComponent(j.key), {
        method: 'PUT',
        headers: { 'Content-Type': j.ct },
        credentials: 'same-origin',      // ログインの証は自動で付く
        body: j.f,
      });
      if (!res.ok) {
        let msg = ''; try { msg = (await res.json()).message || ''; } catch (e) {}
        console.error('失敗', j.f.name, '→', j.key, res.status, msg);
        ng++; continue;
      }
      console.log('入れました', j.f.name, '→', j.key, KB(j.f.size));
      ok++;
    } catch (e) {
      console.error('エラー', j.f.name, e && e.message);
      ng++;
    }
  }

  console.log('--------------------------------------------');
  console.log('入れた:', ok, '件 / 失敗:', ng, '件');
  if (ok) {
    console.log('画面に出るまで最大1日かかることがあります（配信側で1日ぶん覚えているため）。');
    console.log('ご自分の画面だけ今すぐ確かめるには Ctrl+Shift+R で開き直してください。');
  }
  return { ok: ok, ng: ng };
};

console.log('用意できました。次のどちらかを実行してください:');
console.log('  uploadCovers()              … ファイルを選んで、割り当ての確認だけ');
console.log('  uploadCovers({apply:true})  … ファイルを選んで、実際に入れる');
