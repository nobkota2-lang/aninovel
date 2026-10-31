// 孤児化した英訳を拾い直して、壊れない置き場へ戻す
// ============================================================
//
// 何が起きたか
//   英訳の置き場は2つある。
//     ① 全文キー   worktr7:en:<本文・ブロックid・人物名から作ったハッシュ>
//     ② 分割キャッシュ worktr_chunk:en:<作品ID>:<番号>
//   ①は本文を1文字直すだけ、人物が1人増減するだけで鍵が変わり、
//   前の訳が誰からも参照されなくなる(孤児化)。読者には機械翻訳が出る。
//   雪女がこれだった。再取り込みで お雪・茂作 が人物一覧から消え、
//   人物名が鍵に入っているため鍵が動き、手訳22件が参照されなくなった。
//
//   ②は作品IDが鍵なので、人物の増減や本文の修正では動かない。
//   猫(4,726件)と坊ちゃん(626件)が無傷だったのはこちらに入っていたから。
//   ビューアは②を先に見るので、②に入れておけば①が動いても読める。
//
// 何をするか
//   1. /api/translate の {orphans:{}} で迷子の訳を全部並べる
//   2. 迷子の持つ「古いブロックid」と、いまの各作品のブロックidを
//      突き合わせて、どの作品の訳かを機械的に決める
//   3. 人が確かめたうえで、②分割キャッシュへ書き戻す
//   4. 書いたあと {probe:true} で読み返して、効いたことを確かめる
//
// なぜ id で突き合わせるのか
//   迷子が持っているのは英訳だけで、原文は持っていない。だから
//   原文テキストでは照合できない。一方、雪女のように「人物だけ変わって
//   本文はそのまま」の場合は id がそっくり残っているので、id の
//   重なり具合がそのまま確からしさになる。重なりが低いものは
//   取り込み直しで id が総入れ替えになった迷子なので、ここでは戻さない
//   (その場合は原文つきの退避 BACKUP_en.js から本文照合で戻す)。
//
// 安全のために
//   ・本文(text)も人物も話者も1つも変えない。英訳だけを置く
//   ・①全文キーには書かない。②にだけ書く。①は触らないので、
//     もし判断を間違えても、いまの表示より悪くはならない
//   ・重なりが8割を下回る組み合わせは、既定で書き込まない
//   ・書く前に必ず内容を見せて、押してもらう
//
// 使い方
//   1. aninovel.com をオーナーのアカウントで開く(どのページでもよい)
//   2. F12 でコンソールを開く
//   3. このファイルの中身を全部貼って Enter
//   4. 出てきた表を確かめて、戻すものだけ「戻す」を押す
//
// 戻したあとに確かめること
//   英語表示でその作品を開く。ビューアは端末にも訳を控えているので、
//   変わらないときは localStorage と IndexedDB の控えを捨てるか、
//   別の端末・シークレットウィンドウで見ること。

(function () {
  'use strict';

  var API = '/api/translate';
  var MIN_OVERLAP = 0.8;   // これを下回る組み合わせは既定で戻さない
  var CHUNK = 1000;        // 1回に送るブロック数(ビューアの _TR_CHUNK と同じ)

  function log() { console.info.apply(console, ['[RECOVER]'].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, ['[RECOVER]'].concat([].slice.call(arguments))); }

  log('ローダー起動');

  var TYPES = ['narration', 'dialogue', 'chapter_break', 'section_break'];

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

  // --- 迷子と作品の確からしさを測る -------------------------------
  // 迷子の持つ古い id が、いまの本文の id にどれだけ重なるか。
  // 分母は「いまの本文の件数」。迷子側に余分があっても構わないが、
  // いまの本文が埋まらないなら戻す意味がない。
  function overlap(orphanItems, liveBlocks) {
    var have = Object.create(null);
    (orphanItems || []).forEach(function (x) {
      if (x && x.id && x.text != null && x.text !== '') have[x.id] = x.text;
    });
    var hit = 0;
    (liveBlocks || []).forEach(function (b) {
      if (Object.prototype.hasOwnProperty.call(have, b.id)) hit++;
    });
    var n = (liveBlocks || []).length;
    return {
      hit: hit, total: n,
      ratio: n ? hit / n : 0,
      余り: Object.keys(have).length - hit,
    };
  }

  // 迷子側の訳が英語として成立しているか(原文が残っていれば機械翻訳の残骸)
  function srcLeft(items, source) {
    var re = (source === 'ko') ? /[가-힯]/ : /[぀-ヿ㐀-鿿]/;
    var n = 0;
    (items || []).forEach(function (x) { if (x && re.test(String(x.text || ''))) n++; });
    return n;
  }

  // --- いまの訳を読む(退避モード) ----------------------------------
  async function readCurrent(workId) {
    var items = Object.create(null), chars = Object.create(null), part = 0, from = null;
    for (;;) {
      var r = await post({ dump: { part: part, size: 1200 }, workId: workId, target: 'en' });
      if (r.status !== 200 || !r.json) break;
      from = r.json.from;
      (r.json.blocks || []).forEach(function (b) {
        if (b && b.id && b.en != null && b.en !== '') items[b.id] = String(b.en);
      });
      (r.json.chars || []).forEach(function (c) {
        if (c && c.id && c.en != null && c.en !== '') chars[c.id] = String(c.en);
      });
      part++;
      if (part >= (r.json.totalParts || 1)) break;
    }
    return { items: items, chars: chars, from: from };
  }

  // --- 補填する(置き換えない) --------------------------------------
  // いまの訳のほうが新しいかもしれないので、迷子で上書きはしない。
  // 「いまが欠けている」「いまに原文が残っている」ところにだけ入れる。
  // これなら判断を間違えても、いまの表示より悪くはならない。
  function merge(live, cur, orphan, source) {
    var re = (source === 'ko') ? /[가-힯]/ : /[぀-ヿ㐀-鿿]/;
    var old = Object.create(null);
    (orphan.items || []).forEach(function (x) {
      if (x && x.id && x.text != null && x.text !== '' && !re.test(String(x.text))) {
        old[x.id] = String(x.text);
      }
    });
    var out = [], kept = 0, filled = 0, still = 0;
    live.forEach(function (b) {
      var now = cur.items[b.id];
      var good = (now != null && now !== '' && !re.test(now));
      if (good) { out.push([b.id, now]); kept++; return; }
      if (Object.prototype.hasOwnProperty.call(old, b.id)) { out.push([b.id, old[b.id]]); filled++; return; }
      if (now != null && now !== '') { out.push([b.id, now]); }  // 原文のままでも消さない
      still++;
    });
    return { pairs: out, 現状維持: kept, 迷子から補填: filled, まだ無い: still };
  }

  function mergeChars(work, cur, orphan, source) {
    var re = (source === 'ko') ? /[가-힯]/ : /[぀-ヿ㐀-鿿]/;
    var old = Object.create(null);
    (orphan.characters || []).forEach(function (c) {
      if (c && c.id && c.name && !re.test(String(c.name))) old[c.id] = String(c.name);
    });
    var out = {}, kept = 0, filled = 0;
    Object.keys(work.charIds).forEach(function (id) {
      if (id === 'narrator') return;
      var now = cur.chars[id];
      if (now != null && now !== '' && !re.test(now)) { out[id] = now; kept++; return; }
      if (Object.prototype.hasOwnProperty.call(old, id)) { out[id] = old[id]; filled++; }
    });
    return { map: out, 現状維持: kept, 迷子から補填: filled };
  }

  // --- 書き戻し ----------------------------------------------------
  // ②分割キャッシュへ送る。作品IDが鍵なので、このあと人物を直しても
  // 本文を直しても外れない。ビューアは②を先に見る。
  async function writeBack(work, orphan, m, mc) {
    var pairs = m.pairs;
    if (!pairs.length) throw new Error('戻せる訳が1件もありません');
    var chars = mc.map;
    var total = Math.ceil(pairs.length / CHUNK);
    var sent = 0;
    for (var p = 0; p < total; p++) {
      var slice = pairs.slice(p * CHUNK, p * CHUNK + CHUNK);
      var items = {};
      slice.forEach(function (kv) { items[kv[0]] = kv[1]; });
      var r = await post({
        target: 'en', workId: work.id,
        titleTr: orphan.title || '', authorTr: orphan.author || '',
        chunk: { write: true, part: p, total: total, items: items, chars: (p === 0 ? chars : {}) },
      });
      if (r.status !== 200 || !r.json || !r.json.ok) {
        throw new Error('part ' + p + ' の書き込みに失敗: HTTP ' + r.status + ' ' + r.text.slice(0, 120));
      }
      sent += slice.length;
    }

    // 読み返す。書いたと言うだけで済ませない。
    var back = {}, parts = 0;
    for (var q = 0; q < total; q++) {
      var g = await post({ target: 'en', workId: work.id, chunk: { part: q } });
      if (g.status !== 200 || !g.json) break;
      Object.assign(back, g.json.items || {});
      parts = q + 1;
    }
    var mismatch = 0;
    pairs.forEach(function (kv) { if (back[kv[0]] !== kv[1]) mismatch++; });

    return { 送った: sent, 分割数: total, 読み返した分割数: parts,
             読み返した件数: Object.keys(back).length, 食い違い: mismatch,
             人物: Object.keys(chars).length };
  }

  // --- 画面 --------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  (async function main() {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;width:min(94vw,620px);'
      + 'max-height:88vh;overflow:auto;background:#fff;color:#111;z-index:2147483000;'
      + 'border:2px solid #6366F1;border-radius:12px;padding:16px 18px;'
      + 'box-shadow:0 10px 40px rgba(0,0,0,.3);font:14px/1.7 system-ui,sans-serif';
    box.innerHTML = '<div style="font-weight:700;font-size:1.05rem">孤児化した英訳の拾い直し</div>'
      + '<div id="st" style="margin-top:8px">迷子を探しています…</div>';
    document.body.appendChild(box);
    var st = box.querySelector('#st');

    // 迷子
    var orph = await post({ orphans: { limit: 30 } });
    if (orph.status === 401 || orph.status === 403) {
      st.textContent = 'オーナーのアカウントでログインしてから実行してください (HTTP ' + orph.status + ')';
      return;
    }
    if (!orph.json || !orph.json.ok) {
      st.textContent = '迷子を調べられませんでした: HTTP ' + orph.status + ' ' + orph.text.slice(0, 160);
      return;
    }
    var keys = orph.json['迷子の鍵'] || [];
    log('迷子', keys.length, '件 / 生きている鍵', orph.json['生きている鍵'], '件');
    if (!keys.length) {
      st.innerHTML = '迷子はありませんでした。'
        + '<div style="margin-top:6px;font-size:12px;color:#555">生きている鍵 '
        + orph.json['生きている鍵'] + ' 件を確認しました。</div>';
      return;
    }

    // いまの作品
    st.textContent = '作品の本文を読んでいます…';
    var cat = await fetch('/api/catalog', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
    var works = [];
    for (var i = 0; i < (((cat && cat.works) || []).length); i++) {
      var row = cat.works[i];
      var w = await fetch('/api/works/' + encodeURIComponent(row.id),
        { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      var ww = w && (w.work || w);
      if (!ww || !Array.isArray(ww.content)) continue;
      var charIds = Object.create(null);
      (ww.characters || []).forEach(function (c) { if (c && c.id) charIds[c.id] = 1; });
      works.push({
        id: row.id, title: (ww.novel && ww.novel.title) || row.title || row.id,
        body: ww.content.filter(function (it) {
          return it && it.text && TYPES.indexOf(it.type) >= 0;
        }).map(function (it) { return { id: it.id }; }),
        charIds: charIds,
      });
    }
    log('作品', works.length, '件');

    // 迷子ごとに、いちばん重なる作品を探す
    st.textContent = '迷子の中身を読んでいます…';
    var cands = [];
    for (var k = 0; k < keys.length; k++) {
      var v = await post({ orphans: { key: keys[k] } });
      if (v.status !== 200 || !v.json) { cands.push({ key: keys[k], error: 'HTTP ' + v.status }); continue; }
      var o = v.json;
      var best = null;
      works.forEach(function (w) {
        var ov = overlap(o.items, w.body);
        if (!best || ov.ratio > best.ov.ratio) best = { work: w, ov: ov };
      });
      cands.push({
        key: keys[k], orphan: o, best: best,
        件数: (o.items || []).length,
        原文のまま: srcLeft(o.items, o.source || 'ja'),
      });
    }
    cands.sort(function (a, b) {
      return ((b.best && b.best.ov.ratio) || 0) - ((a.best && a.best.ov.ratio) || 0);
    });

    var html = '<div style="font-weight:700;font-size:1.05rem">孤児化した英訳の拾い直し</div>'
      + '<div style="margin:8px 0 12px;font-size:13px">迷子 ' + keys.length + ' 件。'
      + '戻し先は<b>分割キャッシュ</b>です(作品IDが鍵なので、このあと人物や本文を直しても外れません)。'
      + '本文・人物・話者は変えません。</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12.5px">'
      + '<tr style="text-align:left;border-bottom:1px solid #ddd">'
      + '<th>迷子の題</th><th style="text-align:right">件数</th>'
      + '<th>戻し先</th><th style="text-align:right">重なり</th><th></th></tr>';
    cands.forEach(function (c, n) {
      if (c.error) {
        html += '<tr style="color:#b91c1c"><td colspan="5">' + esc(c.key) + ' — ' + esc(c.error) + '</td></tr>';
        return;
      }
      var ov = c.best && c.best.ov;
      var pct = ov ? Math.round(ov.ratio * 1000) / 10 : 0;
      var good = ov && ov.ratio >= MIN_OVERLAP && c['原文のまま'] === 0;
      html += '<tr style="border-bottom:1px solid #f0f0f0">'
        + '<td>' + esc(c.orphan.title || '(題名なし)')
        + (c['原文のまま'] ? '<br><span style="color:#b45309">原文のまま ' + c['原文のまま'] + ' 件</span>' : '')
        + '</td>'
        + '<td style="text-align:right">' + c['件数'] + '</td>'
        + '<td>' + esc(c.best ? c.best.work.title : '—') + '</td>'
        + '<td style="text-align:right;color:' + (good ? '#047857' : '#b45309') + '">'
        + pct + '%<br><span style="font-size:11px">' + (ov ? ov.hit + '/' + ov.total : '') + '</span></td>'
        + '<td>' + (good
          ? '<button data-n="' + n + '" class="rc" style="cursor:pointer;font-weight:700">戻す</button>'
          : '<span style="font-size:11px;color:#777">自動では戻しません</span>')
        + '</td></tr>';
    });
    html += '</table>'
      + '<div style="margin-top:12px;font-size:12px;color:#555">'
      + '重なりが ' + (MIN_OVERLAP * 100) + '% 未満、または訳に原文が残っているものは、'
      + 'ボタンを出しません。取り込み直しでブロックidが総入れ替えになった迷子なので、'
      + '原文つきの退避(BACKUP_en.js)から本文照合で戻してください。</div>'
      + '<div style="margin-top:10px"><button id="cl" style="padding:8px 14px;border-radius:8px;cursor:pointer">閉じる</button></div>'
      + '<pre id="lg" style="margin-top:10px;font-size:12px;white-space:pre-wrap"></pre>';
    box.innerHTML = html;
    var lg = box.querySelector('#lg');
    box.querySelector('#cl').onclick = function () { if (box.parentNode) box.parentNode.removeChild(box); };

    box.querySelectorAll('.rc').forEach(function (btn) {
      btn.onclick = async function () {
        var c = cands[+btn.getAttribute('data-n')];
        btn.disabled = true; btn.textContent = 'いまの訳を読んでいます…';
        try {
          var src = c.orphan.source || 'ja';
          var cur = await readCurrent(c.best.work.id);
          var m = merge(c.best.work.body, cur, c.orphan, src);
          var mc = mergeChars(c.best.work, cur, c.orphan, src);
          var ask = c.best.work.title + '\n\n'
            + '本文 ' + c.best.work.body.length + ' 件のうち\n'
            + '　いまの訳をそのまま使う: ' + m['現状維持'] + ' 件\n'
            + '　迷子から補填する: ' + m['迷子から補填'] + ' 件\n'
            + '　どちらにも無い: ' + m['まだ無い'] + ' 件\n\n'
            + '人物\n'
            + '　いまのまま: ' + mc['現状維持'] + ' 名\n'
            + '　迷子から補填: ' + mc['迷子から補填'] + ' 名\n\n'
            + 'いまある訳は上書きしません。欠けているところだけ埋めます。\n'
            + '書き込み先は分割キャッシュです。続けますか?';
          if (m['迷子から補填'] === 0 && mc['迷子から補填'] === 0) {
            lg.textContent += c.best.work.title + ': 補填できるものがありませんでした(いまの訳で足りています)\n';
            btn.textContent = '補填なし';
            return;
          }
          if (!confirm(ask)) { btn.disabled = false; btn.textContent = '戻す'; return; }
          btn.textContent = '書き込んでいます…';
          var res = await writeBack(c.best.work, c.orphan, m, mc);
          var pr = await post({ probe: true, workId: c.best.work.id });
          lg.textContent += c.best.work.title + ': 補填 ' + m['迷子から補填'] + ' 件 / 人物 '
            + mc['迷子から補填'] + ' 名\n';
          var line = c.best.work.title + ' → 送った ' + res['送った'] + ' 件'
            + ' / 読み返し ' + res['読み返した件数'] + ' 件'
            + ' / 食い違い ' + res['食い違い'] + ' 件'
            + ' / 人物 ' + res['人物'] + ' 名'
            + '\n  点検: ' + (pr.json ? (pr.json['判定'] + ' (元=' + pr.json['取り出し元']
              + ' 訳がある=' + pr.json['訳がある'] + '/' + pr.json.blocks
              + ' 原文のまま=' + pr.json['原文のまま'] + ')') : 'HTTP ' + pr.status);
          lg.textContent += line + '\n';
          log(line);
          btn.textContent = res['食い違い'] === 0 ? '戻しました' : '要確認';
        } catch (e) {
          lg.textContent += '失敗: ' + ((e && e.message) || e) + '\n';
          warn(e);
          btn.disabled = false; btn.textContent = 'もう一度';
        }
      };
    });

    window.__anvRecover = { orphans: orph.json, cands: cands, works: works, overlap: overlap };
    log('パネルを出しました。window.__anvRecover に結果が入っています。');
  })();
})();
