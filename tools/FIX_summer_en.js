// 夏の日の冒険 の英訳を入れる
// ============================================================
//
// なぜ必要か
//   見本3作品のうち、秘密の庭と星降るカフェには英訳が入っているのに、
//   この作品だけ一度も訳されていなかった(本文8件・訳0件)。
//   英語モードで開くと、そのつど機械翻訳が走る。
//
// 入れる先
//   分割キャッシュ(worktr_chunk:en:summer-adventure:0)。
//   作品IDが鍵なので、このあと本文を直しても人物を増やしても外れない。
//   全文キー(worktr7:)は本文と人物名のハッシュが鍵なので、
//   1文字直すだけで孤児になる。そちらには書かない。
//
// 訳の方針
//   ・固有名詞はヘボン式ローマ字。姓→名の順(_VV_EN と揃える)
//       田中 健太 = Tanaka Kenta / 佐藤 美咲 = Satō Misaki
//   ・懐中電灯は torch。サイトの英語は英国綴り(colours)に揃えてある
//   ・「。。。」「...」は … に寄せる
//
// 安全性
//   本文(text)も人物も話者も変えない。英訳を置くだけ。
//   送ったあと読み返して、1件ずつ一致を確かめる。
//
// 使い方
//   aninovel.com をオーナーのアカウントで開き、コンソールに貼り付ける。
//   どのページでもよい(作品を開いている必要はない)。

(function () {
  'use strict';

  var WORK = 'summer-adventure';

  // 本文の id → 英訳。id は公開APIで確認した実物。
  var EN = {
    c1: 'The midsummer sun beat down as the boy walked the path along the shore. '
      + 'The sea wind brushed his cheek, and somewhere far off the gulls were crying.',
    c2: 'We made it at last! So this is the cave everyone talks about.',
    c3: 'But it’s a little scary… Are we really going inside?',
    c4: 'The two of them stood at the mouth of the cave and gazed into the dark. '
      + 'Waiting there was an adventure beyond anything they had imagined.',
    c6: 'Inside, the cave was cooler than they expected, and water dripped from the '
      + 'ceiling, drop after drop. When the torchlight swept the wall, strange '
      + 'patterns rose out of the stone.',
    c7: 'Amazing! Look — there’s something drawn on the wall! It looks like an ancient map!',
    c8: 'You’re right… isn’t this a treasure map? Kenta — could this be the one '
      + 'everyone whispers about…!',
    c9: 'Their eyes lit up. The greatest adventure of the summer holidays was about to begin.',
  };

  // 人物の英名。ナレーターは送らない(鍵にも入らない)。
  var CHARS = {
    char1: 'Tanaka Kenta',
    char2: 'Satō Misaki',
  };

  var TITLE_EN = 'A Summer Day’s Adventure';
  var AUTHOR_EN = 'Yamada Tarō';

  function log() { console.info.apply(console, ['[FIX-summer]'].concat([].slice.call(arguments))); }

  log('ローダー起動');

  function post(body) {
    return fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        return { status: r.status, json: j, text: t };
      });
    });
  }

  (async function () {
    // 1. いまの本文を読んで、id が合っていることを確かめる。
    //    合っていなければ取り込み直されているので、送らずに止める。
    var w = await fetch('/api/works/' + WORK, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var ww = w && (w.work || w);
    if (!ww || !Array.isArray(ww.content)) { console.error('[FIX-summer] 作品が読めません'); return; }

    var TYPES = ['narration', 'dialogue', 'chapter_break', 'section_break'];
    var body = ww.content.filter(function (it) {
      return it && it.text && TYPES.indexOf(it.type) >= 0;
    });
    var missing = [], extra = [];
    body.forEach(function (b) {
      if (!Object.prototype.hasOwnProperty.call(EN, b.id)) missing.push(b.id);
    });
    Object.keys(EN).forEach(function (id) {
      if (!body.some(function (b) { return b.id === id; })) extra.push(id);
    });
    if (missing.length || extra.length) {
      console.error('[FIX-summer] 本文と訳の対応が合いません。送信を中止します。');
      console.error('  訳の無い本文:', missing);
      console.error('  本文に無い訳:', extra);
      console.error('  取り込み直されている可能性があります。本文を貼っていただければ訳し直します。');
      return;
    }

    // 人物も確かめる
    var liveChars = {};
    (ww.characters || []).forEach(function (c) { if (c && c.id) liveChars[c.id] = c.name; });
    var charNG = Object.keys(CHARS).filter(function (id) { return !liveChars[id]; });
    if (charNG.length) {
      console.error('[FIX-summer] 一覧に無い人物があります。中止します:', charNG);
      return;
    }

    var items = {};
    body.forEach(function (b) { items[b.id] = EN[b.id]; });
    log('本文', body.length, '件 / 訳', Object.keys(items).length, '件 / 人物',
        Object.keys(CHARS).length, '名 — 対応が取れました');

    if (!confirm('夏の日の冒険 の英訳を入れます。\n\n'
      + '本文 ' + body.length + ' 件\n人物 ' + Object.keys(CHARS).length + ' 名\n'
      + '題名 ' + TITLE_EN + '\n著者 ' + AUTHOR_EN + '\n\n'
      + '本文・人物・話者は変えません。英訳を置くだけです。\n続けますか?')) {
      log('中止しました。何も送っていません。');
      return;
    }

    // 2. 送る
    var r = await post({
      target: 'en', workId: WORK, titleTr: TITLE_EN, authorTr: AUTHOR_EN,
      chunk: { write: true, part: 0, total: 1, items: items, chars: CHARS },
    });
    if (r.status !== 200 || !r.json || !r.json.ok) {
      console.error('[FIX-summer] 書き込みに失敗: HTTP ' + r.status, r.text.slice(0, 200));
      return;
    }
    log('送信しました', r.json);

    // 3. 読み返して1件ずつ確かめる
    var g = await post({ target: 'en', workId: WORK, chunk: { part: 0 } });
    if (g.status !== 200 || !g.json) { console.error('[FIX-summer] 読み返せません'); return; }
    var back = g.json.items || {}, bad = 0;
    Object.keys(items).forEach(function (id) { if (back[id] !== items[id]) bad++; });
    var backChars = g.json.chars || {}, badC = 0;
    Object.keys(CHARS).forEach(function (id) { if (backChars[id] !== CHARS[id]) badC++; });

    var pr = await post({ probe: true, workId: WORK });
    log('読み返し: 本文の食い違い', bad, '件 / 人物の食い違い', badC, '件');
    log('点検:', pr.json);
    alert('夏の日の冒険 の英訳を入れました。\n\n'
      + '本文 ' + Object.keys(items).length + ' 件（食い違い ' + bad + ' 件）\n'
      + '人物 ' + Object.keys(CHARS).length + ' 名（食い違い ' + badC + ' 件）\n'
      + '点検: ' + (pr.json ? pr.json['判定'] + '（元=' + pr.json['取り出し元'] + '）' : '—') + '\n\n'
      + (bad || badC ? '食い違いがあります。コンソールを確認してください。'
                     : '英語モードで開くと英訳が出ます。端末に古い控えが残っている場合は、\n'
                     + 'シークレットウィンドウか別の端末で確認してください。'));
  })();
})();
