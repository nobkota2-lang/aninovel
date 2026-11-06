// 雪女の英訳を、ハーンの原文に差し替える
// ============================================================
//
// なぜ差し替えるか
//   『雪女』の原文は Lafcadio Hearn が英語で書いたもの(Kwaidan, 1904)。
//   本文の日本語は田部隆次の訳。いまサイトに入っている英訳は、その
//   日本語訳からの再訳になっていて、ハーン自身の英語ではない。
//   原文は著作権が切れているので、本来はそちらを出すのが正しい。
//
// 差し替えるもの / 差し替えないもの
//   差し替える  : 本文22ブロックの英訳、人物3名の英語名
//   触らない    : 日本語の本文、話者、題名・著者の英語表記、
//                 全文キー側に入っている古い英訳(残るので戻せる)
//
// 入れる文章の作り方
//   手で写していない。原文を段落ごとに機械的に切り出し、
//   「22片を連結すると原文に戻る」ことを確認して生成した。
//   正規化後6,467文字が前後で一致、脱落・重複ゼロ。
//   註記の (1)(2)[1][2] と挿絵の見出しだけ外してある。
//   台詞ブロックは日本語側が引用符を持たない(吹き出しが受け持つ)ので、
//   英語側も “ ” を外した。地の文に出てくる引用符はそのまま。
//
// 安全のための決め事
//   ・書く前に、作品のブロックidが22件ぴったり一致するか確かめる。
//     取り込み直しでidが変わっていたら、何もせず止まる。
//   ・題名・著者の英語は、いま入っている値を読んでそのまま書き戻す。
//     省くと空になるため。
//   ・書くのは分割キャッシュ(作品IDが鍵)だけ。全文キーには触らない。
//     古い再訳はそこに残るので、気が変わっても戻せる。
//   ・書いたあと読み返し、22件を1文字ずつ照合する。
//
// 済んだあとに
//   英語音声22件は、英文が変わるので指紋が合わなくなる。
//   読者には再生されなくなるので、DEL_orphan_audio で片付けること。
//   今度は本物の孤児音声。

(function () {
  'use strict';

  var WORK = 'pub_hearn_yukionna';
  var EN = {
  "imp17886389180360": "In a village of Musashi Province, there lived two woodcutters: Mosaku and Minokichi. At the time of which I am speaking, Mosaku was an old man; and Minokichi, his apprentice, was a lad of eighteen years. Every day they went together to a forest situated about five miles from their village. On the way to that forest there is a wide river to cross; and there is a ferry-boat. Several times a bridge was built where the ferry is; but the bridge was each time carried away by a flood. No common bridge can resist the current there when the river rises.",
  "imp17886389180371": "Mosaku and Minokichi were on their way home, one very cold evening, when a great snowstorm overtook them. They reached the ferry; and they found that the boatman had gone away, leaving his boat on the other side of the river. It was no day for swimming; and the woodcutters took shelter in the ferryman’s hut,—thinking themselves lucky to find any shelter at all. There was no brazier in the hut, nor any place in which to make a fire: it was only a two-mat hut, with a single door, but no window. Mosaku and Minokichi fastened the door, and lay down to rest, with their straw rain-coats over them. At first they did not feel very cold; and they thought that the storm would soon be over.",
  "imp17886389180372": "The old man almost immediately fell asleep; but the boy, Minokichi, lay awake a long time, listening to the awful wind, and the continual slashing of the snow against the door. The river was roaring; and the hut swayed and creaked like a junk at sea. It was a terrible storm; and the air was every moment becoming colder; and Minokichi shivered under his rain-coat. But at last, in spite of the cold, he too fell asleep.",
  "imp17886389180393n0": "He was awakened by a showering of snow in his face. The door of the hut had been forced open; and, by the snow-light (yuki-akari), he saw a woman in the room,—a woman all in white. She was bending above Mosaku, and blowing her breath upon him;—and her breath was like a bright white smoke. Almost in the same moment she turned to Minokichi, and stooped over him. He tried to cry out, but found that he could not utter any sound. The white woman bent down over him, lower and lower, until her face almost touched him; and he saw that she was very beautiful,—though her eyes made him afraid. For a little time she continued to look at him;—then she smiled, and she whispered:—",
  "imp17886389180403u1": "“I intended to treat you like the other man. But I cannot help feeling some pity for you,—because you are so young... You are a pretty boy, Minokichi; and I will not hurt you now. But, if you ever tell anybody—even your own mother—about what you have seen this night, I shall know it; and then I will kill you... Remember what I say!”",
  "imp17886389180404": "With these words, she turned from him, and passed through the doorway. Then he found himself able to move; and he sprang up, and looked out. But the woman was nowhere to be seen; and the snow was driving furiously into the hut. Minokichi closed the door, and secured it by fixing several billets of wood against it. He wondered if the wind had blown it open;—he thought that he might have been only dreaming, and might have mistaken the gleam of the snow-light in the doorway for the figure of a white woman: but he could not be sure. He called to Mosaku, and was frightened because the old man did not answer. He put out his hand in the dark, and touched Mosaku’s face, and found that it was ice! Mosaku was stark and dead...",
  "imp17886389180405": "By dawn the storm was over; and when the ferryman returned to his station, a little after sunrise, he found Minokichi lying senseless beside the frozen body of Mosaku. Minokichi was promptly cared for, and soon came to himself; but he remained a long time ill from the effects of the cold of that terrible night. He had been greatly frightened also by the old man’s death; but he said nothing about the vision of the woman in white. As soon as he got well again, he returned to his calling,—going alone every morning to the forest, and coming back at nightfall with his bundles of wood, which his mother helped him to sell.",
  "imp17886389180406": "One evening, in the winter of the following year, as he was on his way home, he overtook a girl who happened to be traveling by the same road. She was a tall, slim girl, very good-looking; and she answered Minokichi’s greeting in a voice as pleasant to the ear as the voice of a song-bird. Then he walked beside her; and they began to talk. The girl said that her name was O-Yuki; that she had lately lost both of her parents; and that she was going to Yedo, where she happened to have some poor relations, who might help her to find a situation as a servant. Minokichi soon felt charmed by this strange girl; and the more that he looked at her, the handsomer she appeared to be. He asked her whether she was yet betrothed; and she answered, laughingly, that she was free. Then, in her turn, she asked Minokichi whether he was married, or pledged to marry; and he told her that, although he had only a widowed mother to support, the question of an “honorable daughter-in-law” had not yet been considered, as he was very young... After these confidences, they walked on for a long while without speaking; but, as the proverb declares, Ki ga aréba, mé mo kuchi hodo ni mono wo iu: “When the wish is there, the eyes can say as much as the mouth.” By the time they reached the village, they had become very much pleased with each other; and then Minokichi asked O-Yuki to rest awhile at his house. After some shy hesitation, she went there with him; and his mother made her welcome, and prepared a warm meal for her. O-Yuki behaved so nicely that Minokichi’s mother took a sudden fancy to her, and persuaded her to delay her journey to Yedo. And the natural end of the matter was that Yuki never went to Yedo at all. She remained in the house, as an “honorable daughter-in-law.”",
  "imp17886389180407": "O-Yuki proved a very good daughter-in-law. When Minokichi’s mother came to die,—some five years later,—her last words were words of affection and praise for the wife of her son. And O-Yuki bore Minokichi ten children, boys and girls,—handsome children all of them, and very fair of skin.",
  "imp17886389180408": "The country-folk thought O-Yuki a wonderful person, by nature different from themselves. Most of the peasant-women age early; but O-Yuki, even after having become the mother of ten children, looked as young and fresh as on the day when she had first come to the village.",
  "imp17886389180409": "One night, after the children had gone to sleep, O-Yuki was sewing by the light of a paper lamp; and Minokichi, watching her, said:—",
  "imp178863891804010d0": "To see you sewing there, with the light on your face, makes me think of a strange thing that happened when I was a lad of eighteen. I then saw somebody as beautiful and white as you are now—indeed, she was very like you.",
  "imp178863891804110n1": "...",
  "imp178863891804111": "Without lifting her eyes from her work, O-Yuki responded:—",
  "imp178863891804112d0": "Tell me about her... Where did you see her?",
  "imp178863891804113": "Then Minokichi told her about the terrible night in the ferryman’s hut,—and about the White Woman that had stooped above him, smiling and whispering,—and about the silent death of old Mosaku. And he said:—",
  "imp178863891804114d0": "Asleep or awake, that was the only time that I saw a being as beautiful as you. Of course, she was not a human being; and I was afraid of her,—very much afraid,—but she was so white!... Indeed, I have never been sure whether it was a dream that I saw, or the Woman of the Snow.",
  "imp178863891804114n1": "...",
  "imp178863891804115": "O-Yuki flung down her sewing, and arose, and bowed above Minokichi where he sat, and shrieked into his face:—",
  "imp178863891804116d0": "It was I—I—I! Yuki it was! And I told you then that I would kill you if you ever said one word about it!... But for those children asleep there, I would kill you this moment! And now you had better take very, very good care of them; for if ever they have reason to complain of you, I will treat you as you deserve!",
  "imp178863891804116n1": "...",
  "imp178863891804117": "Even as she screamed, her voice became thin, like a crying of wind;—then she melted into a bright white mist that spired to the roof-beams, and shuddered away through the smoke-hole.... Never again was she seen."
};
  var CHARS = { 'narrator': 'Narrator',
                'char1788638918035_d0': 'Minokichi',
                'char1788638918036_d1': 'O-Yuki' };

  function log() { console.info.apply(console, ['[YUKI]'].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, ['[YUKI]'].concat([].slice.call(arguments))); }
  log('ローダー起動');

  function post(body) {
    return fetch('/api/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify(body),
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        return { status: r.status, json: j, text: t };
      });
    });
  }
  async function readCurrent() {
    var cur = {}, chars = {}, part = 0, total = null, from = null, title = '', author = '', ids = [];
    for (;;) {
      var r = await post({ dump: { part: part, size: 1200 }, workId: WORK, target: 'en' });
      if (r.status !== 200 || !r.json) return { ok: false, http: r.status };
      if (total === null) { total = r.json.totalParts || 1; from = r.json.from;
        title = r.json.titleTr || ''; author = r.json.authorTr || ''; }
      (r.json.blocks || []).forEach(function (b) {
        if (b && b.id) { ids.push(String(b.id));
          if (b.en != null) cur[String(b.id)] = String(b.en); }
      });
      if (part === 0) (r.json.chars || []).forEach(function (c) {
        if (c && c.id) chars[c.id] = (c.en == null ? '' : String(c.en)); });
      part++;
      if (part >= total) break;
    }
    return { ok: true, cur: cur, chars: chars, from: from, title: title, author: author, ids: ids };
  }
  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  (async function () {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;width:min(94vw,820px);'
      + 'max-height:90vh;overflow:auto;background:#fff;color:#111;z-index:2147483000;'
      + 'border:2px solid #0F766E;border-radius:12px;padding:16px 18px;'
      + 'box-shadow:0 10px 40px rgba(0,0,0,.3);font:14px/1.7 system-ui,sans-serif';
    box.innerHTML = '<div style="font-weight:700;font-size:1.05rem">雪女の英訳をハーンの原文に差し替える</div>'
      + '<div id="st" style="margin-top:8px">確かめています…</div>';
    document.body.appendChild(box);
    var st = box.querySelector('#st');

    // 本文のブロックidを突き合わせる
    var wk = await fetch('/api/works/' + WORK, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    if (!wk) { st.textContent = '作品が読めませんでした。'; return; }
    var blocks = (wk.content || []).filter(function (b) { return b && b.id; });
    var liveIds = blocks.map(function (b) { return String(b.id); });
    var want = Object.keys(EN);
    var missing = want.filter(function (k) { return liveIds.indexOf(k) < 0; });
    var extra = liveIds.filter(function (k) { return want.indexOf(k) < 0; });

    var cu = await readCurrent();
    if (!cu.ok) {
      st.textContent = (cu.http === 401 || cu.http === 403)
        ? 'オーナーのアカウントでログインしてから実行してください (HTTP ' + cu.http + ')'
        : 'いまの訳が読めませんでした (HTTP ' + cu.http + ')';
      return;
    }

    var h = '<div style="font-weight:700;font-size:1.05rem">雪女の英訳をハーンの原文に差し替える</div>';
    if (missing.length || extra.length) {
      h += '<div style="margin-top:10px;padding:10px 12px;background:#FEE2E2;border-radius:8px">'
        + '<div style="font-weight:700;color:#DC2626">ブロックidが一致しません。何もしません。</div>'
        + '<div style="font-size:12px;margin-top:6px">用意した訳にあって本文に無いid: ' + missing.length + ' 件<br>'
        + '本文にあって用意した訳に無いid: ' + extra.length + ' 件<br>'
        + '取り込み直しでidが変わった可能性があります。差し替えの表を作り直す必要があります。</div>'
        + '<pre style="font-size:11px;white-space:pre-wrap;margin-top:6px">'
        + esc(missing.concat(extra).slice(0, 12).join('\n')) + '</pre></div>'
        + '<div style="margin-top:14px"><button id="cl" style="padding:8px 14px;border-radius:8px;cursor:pointer">閉じる</button></div>';
      box.innerHTML = h;
      box.querySelector('#cl').onclick = function () { box.remove(); };
      warn('id 不一致', { missing: missing, extra: extra });
      return;
    }

    h += '<div style="margin:8px 0 12px;font-size:13px">ブロックid 22件すべて一致しました。'
      + 'いまの訳の取り出し元: <b>' + esc(cu.from || '—') + '</b>。'
      + '日本語の本文・話者・題名の英語には触りません。全文キー側の古い再訳も残します。</div>';

    h += '<div style="max-height:46vh;overflow:auto;border:1px solid #ddd;border-radius:8px">'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    blocks.forEach(function (b, n) {
      var id = String(b.id), now = cu.cur[id] == null ? '' : cu.cur[id], neu = EN[id];
      h += '<tr style="border-bottom:1px solid #eee;vertical-align:top">'
        + '<td style="padding:6px;width:24px;color:#888">' + (n + 1) + '</td>'
        + '<td style="padding:6px;width:30%;color:#555">' + esc(b.text.slice(0, 90)) + '</td>'
        + '<td style="padding:6px;width:35%;background:#FEF2F2">' + esc(now.slice(0, 110) || '（訳なし）') + '</td>'
        + '<td style="padding:6px;width:35%;background:#F0FDF4">' + esc(neu.slice(0, 110)) + '</td></tr>';
    });
    h += '</table></div>'
      + '<div style="font-size:11px;color:#666;margin-top:4px">'
      + '左から: 日本語本文 ／ <span style="background:#FEF2F2">いまの再訳</span>'
      + ' ／ <span style="background:#F0FDF4">ハーンの原文</span>（各110字まで）</div>';

    var cnames = (wk.characters || []).map(function (c) {
      return esc(c.name) + ': ' + esc(cu.chars[c.id] || '（無し）') + ' → ' + esc(CHARS[c.id] || '（変えません）');
    });
    h += '<div style="margin-top:10px;font-size:12px">人物名: ' + cnames.join(' ／ ') + '</div>'
      + '<div style="margin-top:4px;font-size:12px">題名の英語「' + esc(cu.title || '（空）')
      + '」と著者「' + esc(cu.author || '（空）') + '」は、読んだ値をそのまま書き戻します。</div>'
      + '<div style="margin-top:12px"><button id="go" style="padding:10px 16px;border-radius:8px;border:0;'
      + 'background:#0F766E;color:#fff;font-weight:700;cursor:pointer">22件を差し替える</button>'
      + ' <button id="cl" style="padding:10px 14px;border-radius:8px;cursor:pointer">閉じる</button></div>'
      + '<pre id="lg" style="margin-top:10px;font-size:12px;white-space:pre-wrap"></pre>';
    box.innerHTML = h;
    var lg = box.querySelector('#lg');
    box.querySelector('#cl').onclick = function () { box.remove(); };

    box.querySelector('#go').onclick = async function () {
      var btn = this;
      if (!confirm('雪女の英訳22件を、ハーンの原文に差し替えます。\n\n'
        + '日本語の本文は変わりません。古い再訳は全文キー側に残るので戻せます。\n'
        + '差し替えると英語音声22件は指紋が合わなくなり、再生されなくなります。\n続けますか?')) return;
      btn.disabled = true; btn.textContent = '書いています…';
      try {
        var chars = {};
        Object.keys(cu.chars).forEach(function (k) { chars[k] = cu.chars[k]; });
        Object.keys(CHARS).forEach(function (k) { chars[k] = CHARS[k]; });
        var r = await post({ target: 'en', workId: WORK,
          titleTr: cu.title || '', authorTr: cu.author || '',
          chunk: { write: true, part: 0, total: 1, items: EN, chars: chars } });
        if (r.status !== 200 || !r.json || !r.json.ok) {
          throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0, 180));
        }
        // 読み返して1文字ずつ照合する
        var back = await readCurrent();
        if (!back.ok) throw new Error('読み返せませんでした (HTTP ' + back.http + ')');
        var bad = [], blank = [];
        Object.keys(EN).forEach(function (k) {
          if (back.cur[k] !== EN[k]) bad.push(k);
          if (!back.cur[k]) blank.push(k);
        });
        var cbad = Object.keys(CHARS).filter(function (k) { return back.chars[k] !== CHARS[k]; });
        var line = '差し替えた 22 件 / 食い違い ' + bad.length + ' 件 / 空 ' + blank.length + ' 件\n'
          + '  人物名の食い違い ' + cbad.length + ' 件\n'
          + '  取り出し元: ' + back.from + ' / 題名: ' + (back.title || '（空）')
          + ' / 著者: ' + (back.author || '（空）');
        lg.textContent += line + '\n';
        log(line);
        if (bad.length) warn('食い違い', bad);
        btn.textContent = (bad.length === 0 && cbad.length === 0) ? '差し替えました' : '要確認';
        if (bad.length === 0 && cbad.length === 0) {
          lg.textContent += '英語音声22件が宛先を失いました。DEL_orphan_audio で片付けてください。\n';
        }
      } catch (e) {
        lg.textContent += '失敗 — ' + ((e && e.message) || e) + '\n';
        warn(e);
        btn.disabled = false; btn.textContent = 'もう一度';
      }
    };

    window.__anvYuki = { EN: EN, CHARS: CHARS, current: cu, blocks: blocks };
    log('パネルを出しました。window.__anvYuki に入っています。');
  })();
})();
