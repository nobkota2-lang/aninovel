// 英訳をディスクへ退避する
// ============================================================
//
// なぜ必要か
//   手で訳した英文は、サーバの中では
//     worktr7:en:<「本文・ブロックid・人物名」から作ったハッシュ>
//   という鍵の下にしか無い。だから
//     ・本文を1文字直す
//     ・青空文庫の .txt を取り込み直す
//     ・人物を増やす/消す
//   のどれをしても鍵が変わり、訳が孤児になって機械翻訳に戻る。
//   注文の多い料理店(164件)と吾輩は猫である(4,726件)で実際に起きた。
//
//   いま全作品ぶんの手訳は**サーバの中にしか無い**。
//   取り出してディスクに置くまでは、取り返しのつく状態ではない。
//
// 何をするか
//   /api/translate の退避モード({dump:...})を呼んで、各作品の
//   「原文」と「いま入っている英訳」を対で取り出し、JSONで保存する。
//   読むだけ。サーバのデータは1バイトも変えない。
//   AI も呼ばないので無料枠を使わず、何度でも実行できる。
//
// 復元できる形にしてある
//   取り込み直すと id も話者判別の結果も変わるので、復元は
//   id ではなく**原文テキスト**で照合する。そのため
//     blocks: [{id, type, ja, en}]      … 人が読んで確かめる用
//     byText: { 正規化した原文: 英訳 }   … 復元に使う対応表
//   の両方を書き出す。正規化は「空白除去＋かぎ括弧除去＋外字除去」。
//
// 使い方
//   1. aninovel.com を作者かオーナーのアカウントで開く(どのページでもよい)
//   2. F12 でコンソールを開く
//   3. このファイルの中身を全部貼って Enter
//   4. 出てきたパネルで中身を確かめて「全部まとめて保存」
//   5. 落ちてきたファイルを、リポジトリの**外**に置く
//      (例 E:\aninovel\en-backup\)。リポジトリは公開で、
//      中に置くと aninovel.com から誰でも落とせてしまう。
//
// 保存したあとに確かめること
//   ・判定が「健全」でない作品があれば、そこは既に壊れている。
//     退避したファイルの en が null や日本語のままになっている。
//     その作品は退避より先に修復が要る。
//   ・件数が 0 の作品は、まだ訳が入っていないか鍵が変わっている。

(function () {
  'use strict';

  var API = '/api/translate';
  var SIZE = 1200;          // 1回の応答で受け取るブロック数
  var GAP_MS = 450;         // 連続ダウンロードの間隔(ブラウザに弾かれないように)

  function log() { console.info.apply(console, ['[BACKUP]'].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, ['[BACKUP]'].concat([].slice.call(arguments))); }

  log('ローダー起動');

  // --- 復元で使う照合キー ---------------------------------------
  // 取り込みのたびに、同じ台詞が「セリフ」にも「かぎ括弧付きの地の文」にも
  // なる。空白とかぎ括弧を落とさないと照合が外れる(注文の多い料理店で
  // 18件が外れた)。外字は ※ が残る版と実文字になる版があるので落とす。
  function normKey(s) {
    return String(s == null ? '' : s)
      .replace(/[\s\u3000]+/g, '')
      .replace(/[「」『』]/g, '')
      .replace(/[\u203B\u7736\u626D\u5321]/g, '');
  }

  function post(body) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) {}
        return { status: r.status, json: j, text: t };
      });
    });
  }

  // --- 1作品を退避する -------------------------------------------
  function dumpWork(id) {
    var acc = null, part = 0;
    function step() {
      return post({ dump: { part: part, size: SIZE }, workId: id, target: 'en' })
        .then(function (r) {
          if (r.status === 401 || r.status === 403) {
            throw new Error('権限がありません (HTTP ' + r.status + ')。作者かオーナーでログインしてください。');
          }
          if (r.status === 404) throw new Error('この作品はサーバにありません');
          if (!r.json) throw new Error('HTTP ' + r.status + ' / JSONではない応答: ' + r.text.slice(0, 120));
          if (r.json.error) throw new Error(r.json.error + ' ' + (r.json.message || ''));
          if (!acc) {
            acc = r.json;
            acc.blocks = (r.json.blocks || []).slice();
          } else {
            acc.blocks = acc.blocks.concat(r.json.blocks || []);
            acc['訳が無い'] += r.json['訳が無い'];
            acc['原文のまま'] += r.json['原文のまま'];
          }
          part++;
          if (part < (r.json.totalParts || 1)) return step();
          return acc;
        });
    }
    return step();
  }

  // --- 退避したものを、復元に使える形に組み替える -----------------
  function buildBackup(d, catRow) {
    // Object.create(null) にする。素の {} だと原文が偶然 __proto__ だった
    // ときに代入が黙って消える。復元側も同じ作りにすること。
    var byText = Object.create(null), dup = [], empty = 0;
    (d.blocks || []).forEach(function (b) {
      if (b.en == null || b.en === '') { empty++; return; }
      var k = normKey(b.ja);
      if (!k) return;
      if (Object.prototype.hasOwnProperty.call(byText, k)) {
        // 同じ原文が2回出るのは普通にある(メロスの「いや、まだ陽は沈まぬ。」)。
        // 訳まで同じなら害は無い。違うときだけ知らせる。
        if (byText[k] !== b.en) dup.push({ key: k.slice(0, 40), a: byText[k], b: b.en });
        return;
      }
      byText[k] = b.en;
    });

    var chars = Object.create(null);
    (d.chars || []).forEach(function (c) { if (c.en) chars[c.ja] = c.en; });

    return {
      _: 'aninovel english backup v1',
      _復元のしかた: 'byText は「空白・かぎ括弧・外字を除いた原文」が鍵。'
        + '復元器は各ブロックの本文を同じ規則で正規化して引く。id では引かない。',
      取得日時: new Date().toISOString(),
      workId: d.workId,
      title: d.title,
      titleEn: d.titleTr || (catRow && catRow.titleEn) || '',
      author: d.author,
      authorEn: d.authorTr || (catRow && catRow.authorEn) || '',
      sourceLang: d.sourceLang,
      取り出し元: d.from,            // key = 全文キー / chunk = 分割キャッシュ
      鍵: d.key,
      件数: (d.blocks || []).length,
      対応表の件数: Object.keys(byText).length,
      訳が無い: d['訳が無い'],
      原文のまま: d['原文のまま'],
      判定: d['判定'],
      訳が重複し食い違うもの: dup,
      chars: chars,
      byText: byText,
      blocks: d.blocks,
    };
  }

  function save(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(a.href); } catch (e) {}
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 4000);
  }

  // --- 画面 -------------------------------------------------------
  function panel() {
    var el = document.createElement('div');
    el.id = 'anv-backup-panel';
    el.style.cssText = 'position:fixed;top:12px;right:12px;width:min(92vw,520px);'
      + 'max-height:86vh;overflow:auto;background:#fff;color:#111;z-index:2147483000;'
      + 'border:2px solid #6366F1;border-radius:12px;padding:16px 18px;'
      + 'box-shadow:0 10px 40px rgba(0,0,0,.3);font:14px/1.7 system-ui,sans-serif';
    document.body.appendChild(el);
    return el;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  (async function main() {
    var box = panel();
    box.innerHTML = '<div style="font-weight:700;font-size:1.05rem">英訳の退避</div>'
      + '<div id="anv-bk-stat" style="margin-top:8px">作品の一覧を読んでいます…</div>';
    var stat = box.querySelector('#anv-bk-stat');

    // 作品の一覧
    var works = [];
    try {
      var r = await fetch('/api/catalog', { credentials: 'same-origin', cache: 'no-store' });
      var j = await r.json();
      works = (j && j.works) || [];
    } catch (e) {
      stat.textContent = '作品の一覧が読めませんでした: ' + (e && e.message);
      return;
    }
    if (!works.length) { stat.textContent = '作品がありません。'; return; }
    log(works.length + ' 作品');

    var results = [];
    for (var i = 0; i < works.length; i++) {
      var w = works[i];
      stat.textContent = (i + 1) + ' / ' + works.length + '　' + (w.title || w.id) + ' を読んでいます…';
      try {
        var d = await dumpWork(w.id);
        var bk = buildBackup(d, w);
        results.push({ ok: true, row: w, bk: bk });
        log(w.title || w.id, bk['件数'] + '件', bk['判定'],
            '対応表' + bk['対応表の件数'] + '件', '元=' + bk['取り出し元']);
      } catch (e) {
        results.push({ ok: false, row: w, error: String((e && e.message) || e) });
        warn(w.title || w.id, '→', (e && e.message) || e);
        // 権限が無いなら以降も全部失敗するので、そこで止める
        if (/権限がありません/.test(String(e && e.message))) {
          stat.textContent = (e && e.message) || '';
          return;
        }
      }
    }

    // 一覧を描く
    var oks = results.filter(function (x) { return x.ok; });
    var ngs = results.filter(function (x) { return !x.ok; });
    var totalBlocks = 0, totalMap = 0, broken = 0;
    oks.forEach(function (x) {
      totalBlocks += x.bk['件数'];
      totalMap += x.bk['対応表の件数'];
      if (x.bk['判定'] !== '健全') broken++;
    });

    var html = '<div style="font-weight:700;font-size:1.05rem">英訳の退避</div>'
      + '<div style="margin:8px 0 12px">読み取り専用です。サーバのデータは変えていません。</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<tr style="text-align:left;border-bottom:1px solid #ddd">'
      + '<th>作品</th><th style="text-align:right">本文</th><th style="text-align:right">対応表</th>'
      + '<th>判定</th><th></th></tr>';
    oks.forEach(function (x, n) {
      var b = x.bk;
      var color = b['判定'] === '健全' ? '#047857' : (b['判定'] === '要修復' ? '#b91c1c' : '#b45309');
      html += '<tr style="border-bottom:1px solid #f0f0f0">'
        + '<td>' + esc(b.title || b.workId) + '</td>'
        + '<td style="text-align:right">' + b['件数'] + '</td>'
        + '<td style="text-align:right">' + b['対応表の件数'] + '</td>'
        + '<td style="color:' + color + '">' + esc(b['判定']) + '</td>'
        + '<td><button data-n="' + n + '" class="anv-bk-one" style="cursor:pointer">保存</button></td>'
        + '</tr>';
    });
    ngs.forEach(function (x) {
      html += '<tr style="border-bottom:1px solid #f0f0f0;color:#b91c1c">'
        + '<td>' + esc(x.row.title || x.row.id) + '</td>'
        + '<td colspan="4">' + esc(x.error) + '</td></tr>';
    });
    html += '</table>';
    html += '<div style="margin-top:12px">合計 ' + totalBlocks + ' ブロック / 対応表 ' + totalMap + ' 件'
      + (broken ? '　<b style="color:#b91c1c">健全でない作品 ' + broken + ' 件</b>' : '') + '</div>';
    html += '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">'
      + '<button id="anv-bk-all" style="flex:1 1 auto;padding:10px;border-radius:8px;border:0;'
      + 'background:#6366F1;color:#fff;font-weight:700;cursor:pointer">全部まとめて保存 ('
      + (oks.length + 1) + ' ファイル)</button>'
      + '<button id="anv-bk-close" style="padding:10px 14px;border-radius:8px;cursor:pointer">閉じる</button>'
      + '</div>'
      + '<div style="margin-top:10px;font-size:12px;color:#555">'
      + '落ちてきたファイルは、リポジトリの<b>外</b>に置いてください'
      + '(例 E:\\aninovel\\en-backup\\)。リポジトリは公開なので、'
      + '中に置くと誰でも落とせる状態になります。</div>';
    box.innerHTML = html;

    function index() {
      return {
        _: 'aninovel english backup index v1',
        取得日時: new Date().toISOString(),
        作品数: oks.length,
        合計ブロック数: totalBlocks,
        合計対応表件数: totalMap,
        作品: oks.map(function (x) {
          return {
            workId: x.bk.workId, title: x.bk.title, titleEn: x.bk.titleEn,
            件数: x.bk['件数'], 対応表の件数: x.bk['対応表の件数'],
            訳が無い: x.bk['訳が無い'], 原文のまま: x.bk['原文のまま'],
            判定: x.bk['判定'], 取り出し元: x.bk['取り出し元'],
            ファイル: x.bk.workId + '_en_backup.json',
          };
        }),
        失敗: ngs.map(function (x) { return { workId: x.row.id, title: x.row.title, error: x.error }; }),
      };
    }

    box.querySelectorAll('.anv-bk-one').forEach(function (btn) {
      btn.onclick = function () {
        var x = oks[+btn.getAttribute('data-n')];
        save(x.bk.workId + '_en_backup.json', x.bk);
      };
    });
    box.querySelector('#anv-bk-close').onclick = function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    };
    box.querySelector('#anv-bk-all').onclick = async function () {
      var btn = this;
      btn.disabled = true;
      for (var n = 0; n < oks.length; n++) {
        btn.textContent = '保存中… ' + (n + 1) + ' / ' + (oks.length + 1);
        save(oks[n].bk.workId + '_en_backup.json', oks[n].bk);
        await new Promise(function (ok) { setTimeout(ok, GAP_MS); });
      }
      save('_en_backup_index.json', index());
      btn.textContent = '保存しました (' + (oks.length + 1) + ' ファイル)';
      log('保存完了', oks.length + 1, 'ファイル');
    };

    window.__anvBackup = { results: results, index: index(), normKey: normKey };
    log('パネルを出しました。window.__anvBackup に結果が入っています。');
  })();
})();
