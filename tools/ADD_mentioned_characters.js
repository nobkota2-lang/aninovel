// 語られるだけの登場人物を、キャストに加える
// ============================================================
//
// なぜ必要か
//   登場人物の一覧は「喋った人」から作られる。だから本文で名前を
//   呼ばれていても、一度も「」の台詞を持たない人物は入らない。
//   『吾輩は猫である』の白君がこれで、2か所の地の文に出るだけで、
//   その言葉は「人間ほど不人情なものはないと言っておらるる」のように
//   間接話法で書かれている。御師匠さん・雪江さん・八っちゃんも同じ。
//
// なぜ自動で入れないか
//   「白君」(猫の知り合い)と「地蔵様」(石のお地蔵さん)を、文字だけで
//   見分けることはできない。回数と前後の文を見せるので、人が選ぶ。
//
// 安全性
//   ・本文(text)は1文字も変えない
//   ・既存ブロックの話者(characterId)も変えない
//   → 英訳の鍵も、音声のハッシュも変わらない。作り直しは起きない
//
// 使い方
//   作者かオーナーでログインし、対象の作品をビューアで開いた状態で
//   このファイルを貼り付ける。パネルが出るので、実在する人物に印を
//   付けて「追加する」。そのあと 📢 上書き公開 を押す。

(function () {
  'use strict';

  // 敬称は 君・さん・先生・氏・ちゃん だけにする。
  // 様・殿 まで入れると 王様・地蔵様・この様・どの殿 のような
  // 人物でないものが大量に混じる。失うのは天璋院様くらいで割に合う。
  var SUF = /(君|さん|先生|氏|ちゃん)$/;
  // 一般的な呼び名。人物ではないので候補から外す。
  var NOISE = ['諸君','君子','皆さん','御客さん','御前さん','坊ちゃん','奥さん',
    '叔父さん','伯父さん','叔母さん','伯母さん','爺さん','婆さん','御嬢さん','嬢さん',
    '番頭さん','無名氏','両君','御両君','お客さん','兄さん','姉さん','母さん','父さん',
    '御母さん','おっかさん','御っかさん','かみさん','じいさん','ばあさん','御苦労さん'];
  var COLORS = [
    ['#FEF3C7','#F59E0B'], ['#DCFCE7','#22C55E'], ['#FCE7F3','#EC4899'],
    ['#E0E7FF','#6366F1'], ['#FFE4E6','#F43F5E'], ['#CFFAFE','#06B6D4'],
    ['#F3E8FF','#A855F7'], ['#FEF9C3','#CA8A04']
  ];

  function base(n) { return String(n || '').replace(SUF, ''); }

  function scan() {
    var cont = (window.state && state.content) || [];
    var cast = ((window.state && state.characters) || []).map(function (c) { return c.name || ''; });
    var known = {};
    cast.forEach(function (n) { known[n] = 1; known[base(n)] = 1; });

    // 名前の先頭は漢字かカタカナに限る。
    // ひらがな始まりを許すと「それでも君」「ねえ苦沙弥君」のように
    // 前の語を巻き込んだ切り出しになる（実データで54件中30件がこれだった）。
    var re = /([一-龥ァ-ヶ][一-龥ぁ-んァ-ヶー]{0,4}(?:君|さん|先生|氏|ちゃん))/g;
    var hit = {};
    cont.forEach(function (it, i) {
      var t = it.text || '', m;
      re.lastIndex = 0;
      while ((m = re.exec(t))) {
        var n = m[1];
        if (n.length < 2) continue;
        if (!hit[n]) hit[n] = { n: n, count: 0, dlg: 0, nar: 0, ex: [] };
        hit[n].count++;
        if (it.type === 'dialogue') hit[n].dlg++; else hit[n].nar++;
        if (hit[n].ex.length < 2) {
          var p = m.index;
          hit[n].ex.push((it.type === 'dialogue' ? '［台詞］' : '［地の文］')
            + t.slice(Math.max(0, p - 24), p + 44));
        }
      }
    });

    var all = Object.keys(hit).map(function (k) { return hit[k]; });
    // 既存のキャストに含まれる／含む名前は落とす（三平君 は 多々良三平君 の一部）
    // 長い候補の一部でしかない名前も落とす（良三平君）
    var out = all.filter(function (c) {
      if (c.count < 2) return false;
      if (NOISE.indexOf(c.n) >= 0) return false;
      // 「金田の奥さん」「琴の御師匠さん」のような説明句は外す。
      // 素の形（御師匠さん）は別の箇所で拾えている。
      if (c.n.indexOf('の') >= 0) return false;
      if (known[c.n] || known[base(c.n)]) return false;
      for (var i = 0; i < cast.length; i++) {
        if (!cast[i]) continue;
        if (cast[i].indexOf(c.n) >= 0 || c.n.indexOf(cast[i]) >= 0) return false;
        if (cast[i].indexOf(base(c.n)) >= 0) return false;
      }
      for (var j = 0; j < all.length; j++) {
        if (all[j] !== c && all[j].n.length > c.n.length
            && all[j].n.indexOf(c.n) >= 0 && all[j].count >= c.count * 0.6) return false;
      }
      return true;
    });
    out.sort(function (a, b) { return b.count - a.count; });
    return out;
  }

  function guessGender(n) {
    if (/君$/.test(n)) return 'male';
    if (/(ちゃん|子)$/.test(n)) return 'female';
    return 'neutral';
  }

  // 実データ（吾輩は猫である 4,726ブロック）での結果:
  //   絞り込み前 54件 → 23件。白君・雪江さん・八っちゃん・御師匠さん・
  //   御夏さんなど実在の人物が残り、切り出しミスはほぼ消えた。
  //   それでも「泥棒君」「蟷螂君」のような言葉遊びは残るので、
  //   最後は人が選ぶ。

  function apply(rows) {
    var now = Date.now(), added = [];
    rows.forEach(function (r, i) {
      var col = COLORS[(state.characters.length + i) % COLORS.length];
      var nm = r.name;
      state.characters.push({
        id: 'char' + now + '_m' + i,
        name: nm,
        shortName: base(nm).slice(0, 2) || nm.slice(0, 2),
        gender: r.gender,
        description: '本文で語られる人物（台詞なし）',
        bubbleColor: col[0],
        iconColor: col[1],
        iconImage: null,
        voicevoxSpeaker: undefined
      });
      added.push(nm);
    });
    // 画像の自動割り当て（あれば）。既存の人物の割り当ては変えない作り。
    try { if (typeof _autoAssignIcons === 'function') _autoAssignIcons(); } catch (e) {
      console.warn('[add-char] 画像の自動割り当ては動きませんでした', e);
    }
    try { if (typeof render === 'function') render(); } catch (e) {}
    return added;
  }

  // ---------------- 画面 ----------------
  var cands = scan();
  var old = document.getElementById('addchar-panel');
  if (old) old.remove();

  var ov = document.createElement('div');
  ov.id = 'addchar-panel';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif';
  var bx = document.createElement('div');
  bx.style.cssText = 'background:#fff;color:#222;border-radius:12px;max-width:760px;width:100%;max-height:86vh;overflow:auto;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.4)';

  if (!cands.length) {
    bx.innerHTML = '<h3 style="margin:0 0 10px;font-size:17px">語られるだけの人物</h3>'
      + '<p style="color:#666;font-size:14px;line-height:1.8">候補は見つかりませんでした。'
      + '本文で2回以上名前を呼ばれていて、まだ登場人物に入っていない人はいないようです。</p>'
      + '<div style="text-align:right;margin-top:16px"><button id="ac-close" style="padding:9px 20px;border:0;border-radius:8px;background:#444;color:#fff;cursor:pointer">閉じる</button></div>';
  } else {
    var rows = cands.map(function (c, i) {
      var g = guessGender(c.n);
      return '<tr style="border-bottom:1px solid #eee">'
        + '<td style="padding:10px 6px;vertical-align:top"><input type="checkbox" id="ac-ck' + i + '" style="width:17px;height:17px"></td>'
        + '<td style="padding:10px 6px;vertical-align:top">'
        + '<input id="ac-nm' + i + '" value="' + c.n.replace(/"/g, '&quot;') + '" style="width:120px;padding:5px 7px;border:1px solid #ddd;border-radius:6px;font:inherit;font-size:13px">'
        + '<div style="margin-top:6px"><select id="ac-gn' + i + '" style="padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px">'
        + '<option value="male"' + (g === 'male' ? ' selected' : '') + '>男性</option>'
        + '<option value="female"' + (g === 'female' ? ' selected' : '') + '>女性</option>'
        + '<option value="neutral"' + (g === 'neutral' ? ' selected' : '') + '>どちらでもない</option>'
        + '</select></div></td>'
        + '<td style="padding:10px 6px;vertical-align:top;font-size:12px;color:#666;white-space:nowrap">'
        + c.count + '回<br><span style="font-size:11px">地の文' + c.nar + ' / 台詞' + c.dlg + '</span></td>'
        + '<td style="padding:10px 6px;vertical-align:top;font-size:11.5px;color:#555;line-height:1.7">'
        + c.ex.map(function (e) { return e.replace(/</g, '&lt;'); }).join('<br>') + '</td>'
        + '</tr>';
    }).join('');

    bx.innerHTML = '<h3 style="margin:0 0 6px;font-size:17px">語られるだけの人物を加える</h3>'
      + '<p style="color:#666;font-size:13px;line-height:1.8;margin:0 0 14px">'
      + '本文で名前を呼ばれているのに、一度も「」の台詞が無いため登場人物に入っていない候補です。<br>'
      + '<b>実在する人物にだけ印を付けてください。</b>「地蔵様」のような物や、一般的な呼びかけも混じります。<br>'
      + '<span style="color:#888">本文も既存の話者も変更しません。英訳と音声は作り直しになりません。</span></p>'
      + '<table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr style="border-bottom:2px solid #ddd;text-align:left;color:#888;font-size:11px">'
      + '<th style="padding:6px">加える</th><th style="padding:6px">名前と性別</th><th style="padding:6px">回数</th><th style="padding:6px">本文での使われ方</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>'
      + '<div id="ac-msg" style="margin-top:14px;font-size:13px"></div>'
      + '<div style="text-align:right;margin-top:16px;display:flex;gap:8px;justify-content:flex-end">'
      + '<button id="ac-close" style="padding:9px 20px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer">閉じる</button>'
      + '<button id="ac-apply" style="padding:9px 22px;border:0;border-radius:8px;background:#8b5e34;color:#fff;font-weight:700;cursor:pointer">追加する</button>'
      + '</div>';
  }

  ov.appendChild(bx);
  document.body.appendChild(ov);
  ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
  document.getElementById('ac-close').onclick = function () { ov.remove(); };

  var btn = document.getElementById('ac-apply');
  if (btn) btn.onclick = function () {
    var picked = [];
    cands.forEach(function (c, i) {
      if (!document.getElementById('ac-ck' + i).checked) return;
      picked.push({
        name: (document.getElementById('ac-nm' + i).value || c.n).trim(),
        gender: document.getElementById('ac-gn' + i).value
      });
    });
    var msg = document.getElementById('ac-msg');
    if (!picked.length) { msg.innerHTML = '<span style="color:#b23a3a">1人も選ばれていません。</span>'; return; }
    var added = apply(picked);
    msg.innerHTML = '<span style="color:#3a7d44;font-weight:700">' + added.length + '人を加えました: '
      + added.join('、') + '</span><br>'
      + '<span style="color:#666">このあと <b>📢 上書き公開</b> を押すと読者に反映されます。'
      + '顔は「登場人物」の画面から選べます。</span>';
    btn.disabled = true;
    btn.style.opacity = '.5';
    console.info('[add-char] 追加:', added);
    console.info('[add-char] 登場人物は', state.characters.length, '人になりました。');
  };

  console.info('[add-char] 候補', cands.length, '件');
  console.table(cands.map(function (c) {
    return { 名前: c.n, 回数: c.count, 地の文: c.nar, 台詞: c.dlg };
  }));
})();
