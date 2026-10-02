// 本文の動くGIFを軽くする（ブラウザのコンソールで実行）
//
// なぜ道具が要るのか
//   挿絵の PNG / JPEG は、配信するときに Cloudflare の変換を通すので
//   こちらで何もしなくても軽くなる。けれど動く GIF は変換に通せない。
//   通すと1コマの静止画になり、動きが消えてしまうため。
//   なので GIF だけは、中身を作り直して入れ直すしかない。
//
// GIF を縮めるには gifsicle が要る（ブラウザの中では作り直せない）。
//   すでに tools\gifsicle\gifsicle.exe に置いてあるはず。
//
// 使い方は3段階
//   1. このファイルを貼って  shrinkGif()        … 対象を一覧し、元を手元に落とす
//   2. PowerShell で gifsicle を回す             … 画面に出るコマンドをそのまま貼る
//   3. もう一度このファイルを貼って  shrinkGif({upload:true})
//                                                … 縮めたファイルを選んで入れ直す
//
// 権限
//   作者かオーナーでログインしていること。それだけ。
//   ログインの証は同一オリジンの通信に自動で付く。

window.shrinkGif = async function (o) {
  o = Object.assign({ upload: false, width: 640, lossy: 100 }, o || {});
  const MB = n => (n / 1048576).toFixed(2) + 'MB';

  // ---- 入れ直し ----
  if (o.upload) {
    const files = await new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file'; i.multiple = true; i.accept = 'image/gif';
      i.onchange = () => res(Array.from(i.files || []));
      i.click();
    });
    if (!files.length) { console.log('ファイルが選ばれていません。'); return; }

    let ok = 0, ng = 0;
    for (const f of files) {
      // 落としたときの名前 <workId>__<mediaId>.gif から戻す
      const m = f.name.replace(/\.gif$/i, '').split('__');
      if (m.length !== 2) {
        console.error('名前から入れ先が分かりません:', f.name,
          '（<作品ID>__<項目ID>.gif の形にしてください）'); ng++; continue;
      }
      const [wid, mid] = m;
      if (f.size > 50 * 1024 * 1024) { console.error('50MBを超えています', f.name); ng++; continue; }
      try {
        const r = await fetch('/api/media/' + encodeURIComponent(wid) + '/' + encodeURIComponent(mid), {
          method: 'PUT', headers: { 'Content-Type': 'image/gif' },
          credentials: 'same-origin', body: f,
        });
        if (!r.ok) {
          let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) {}
          console.error('失敗', f.name, r.status, msg);
          if (r.status === 401 || r.status === 403) console.error('  → 作者かオーナーでログインし直してください。');
          ng++; continue;
        }
        console.log('入れました', f.name, MB(f.size));
        ok++;
      } catch (e) { console.error('エラー', f.name, e.message); ng++; }
    }
    console.log('--------------------------------------------');
    console.log('入れた:', ok, '件 / 失敗:', ng, '件');
    if (ok) console.log('画面に出るまで最大1時間かかります。Ctrl+Shift+R で今すぐ確かめられます。');
    return { ok, ng };
  }

  // ---- 一覧して、元を手元に落とす ----
  const cat = await (await fetch('/api/catalog?cb=' + Date.now(), { cache: 'no-store' })).json();
  const found = [];
  for (const w of (cat.works || [])) {
    let t = '';
    try {
      const r = await fetch('/api/works/' + encodeURIComponent(w.id) + '?cb=' + Date.now(),
        { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok) t = await r.text();
    } catch (e) {}
    if (!t) continue;
    for (const u of [...new Set(t.match(/\/api\/media\/[^"'\\?\s]+/g) || [])]) {
      const p = u.split('/');                 // ['', 'api','media', workId, mediaId]
      const wid = p[3], mid = p[4];
      if (!wid || !mid) continue;
      try {
        const h = await fetch(u + '?raw=1', { cache: 'no-store' });
        if (!h.ok) continue;
        const b = await h.blob();
        if (b.type !== 'image/gif') continue;   // 動かない画像は配信時に変換されるので触らない
        found.push({ title: w.title, wid, mid, size: b.size, blob: b });
      } catch (e) {}
    }
  }

  if (!found.length) { console.log('縮める対象の GIF はありませんでした。'); return; }

  console.table(found.map(f => ({ 作品: f.title, 作品ID: f.wid, 項目ID: f.mid, 大きさ: MB(f.size) })));
  console.log('合計', MB(found.reduce((a, f) => a + f.size, 0)));

  for (const f of found) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f.blob);
    a.download = f.wid + '__' + f.mid + '.gif';   // 入れ直すときに入れ先が分かる名前
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    await new Promise(s => setTimeout(s, 400));
  }

  console.log('');
  console.log('元のGIFを' + found.length + '件、ダウンロードフォルダに落としました。');
  console.log('次に PowerShell で、これをそのまま貼ってください:');
  console.log('');
  console.log('  cd $env:USERPROFILE\\Downloads');
  console.log('  Get-ChildItem *__*.gif | ForEach-Object {');
  console.log('    & "E:\\aninovel\\aninovel\\tools\\gifsicle\\gifsicle.exe" `');
  console.log('      --resize-fit ' + o.width + 'x' + o.width + ' --resize-method=mix -O3 --lossy=' + o.lossy + ' `');
  console.log('      $_.FullName -o ($_.BaseName + ".small.gif")');
  console.log('    "{0}  {1:N0} -> {2:N0} バイト" -f $_.Name, $_.Length, (Get-Item ($_.BaseName + ".small.gif")).Length');
  console.log('  }');
  console.log('');
  console.log('できた .small.gif の名前から .small を外してから');
  console.log('（<作品ID>__<項目ID>.gif の形に戻してから）、もう一度このファイルを貼って');
  console.log('  shrinkGif({upload:true})');
  console.log('を実行し、その .gif を選んでください。');
  return found.map(f => ({ title: f.title, wid: f.wid, mid: f.mid, size: f.size }));
};

console.log('用意できました。');
console.log('  shrinkGif()                … 対象を一覧し、元を手元に落とす');
console.log('  shrinkGif({upload:true})   … 縮めたGIFを選んで入れ直す');
