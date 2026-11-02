// 英訳を、壊れない置き場へ移す
// ============================================================
//
// 何のために
//   英訳の置き場は2つある。
//     ① 全文キー     worktr7:en:<本文・ブロックid・人物名のハッシュ>
//     ② 分割キャッシュ worktr_chunk:en:<作品ID>:<番号>
//   ①は本文を1文字直すだけ、人物を1人増減するだけで鍵が変わり、
//   前の訳が孤児になる。②は作品IDが鍵なので動かない。
//   ビューアは②を先に見るので、②に入れておけば①が動いても読める。
//
//   この道具は、①にしか無い作品の訳を②へ**そのまま写す**。
//   訳の中身は1文字も変えない。置き場を増やすだけ。
//
// これで何ができるようになるか
//   人物の追加・削除・改名、本文の誤字直し、青空文庫ヘッダの掃除——
//   これまで「訳が孤児になる」という理由で先送りしていた編集が、
//   普通にできるようになる。取り込み直しだけは id が変わるので
//   別。そちらは BACKUP_en.js の本文照合で戻す。
//
// 安全性
//   ・読むのは退避モード(dump)、書くのは分割キャッシュだけ
//   ・全文キーには書かない・消さない。元のまま残る
//   ・既に②にある作品は何もしない
//   ・訳が1件も無い作品は何もしない
//   ・書いたあと読み返して1件ずつ照合し、食い違いを数える
//   ・本文・人物・話者は変えない
//
// 使い方
//   aninovel.com をオーナーのアカウントで開き、コンソールに貼り付ける。
//   作品ごとに「移す」、まとめてやるなら「全部移す」。
//
// やったあとに
//   点検(probe)の「元」が key から chunk に変わる。
//   以後その作品は、編集しても訳が外れない。

(function () {
  'use strict';

  var CHUNK = 1000;
  function log() { console.info.apply(console, ['[PIN]'].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, ['[PIN]'].concat([].slice.call(arguments))); }
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

  // いまの訳を全部読む
  async function readAll(workId) {
    var items = [], chars = {}, part = 0, from = null, title = '', author = '', blocks = 0;
    for (;;) {
      var r = await post({ dump: { part: part, size: 1200 }, workId: workId, target: 'en' });
      if (r.status !== 200 || !r.json) break;
      from = r.json.from; title = r.json.titleTr || title; author = r.json.authorTr || author;
      blocks = r.json.totalBlocks || blocks;
      (r.json.blocks || []).forEach(function (b) {
        if (b && b.id && b.en != null && b.en !== '') items.push([b.id, String(b.en)]);
      });
      if (part === 0) {
        (r.json.chars || []).forEach(function (c) {
          if (c && c.id && c.en != null && c.en !== '') chars[c.id] = String(c.en);
        });
      }
      part++;
      if (part >= (r.json.totalParts || 1)) break;
    }
    return { items: items, chars: chars, from: from, title: title, author: author, blocks: blocks };
  }

  // そのまま分割キャッシュへ写す
  async function pin(workId, got) {
    var total = Math.ceil(got.items.length / CHUNK);
    for (var p = 0; p < total; p++) {
      var slice = got.items.slice(p * CHUNK, p * CHUNK + CHUNK);
      var items = {};
      slice.forEach(function (kv) { items[kv[0]] = kv[1]; });
      var r = await post({
        target: 'en', workId: workId,
        titleTr: got.title || '', authorTr: got.author || '',
        chunk: { write: true, part: p, total: total, items: items,
                 chars: (p === 0 ? got.chars : {}) },
      });
      if (r.status !== 200 || !r.json || !r.json.ok) {
        throw new Error('part ' + p + ': HTTP ' + r.status + ' ' + r.text.slice(0, 140));
      }
    }
    // 読み返して1件ずつ照合する
    var back = {}, backChars = {};
    for (var q = 0; q < total; q++) {
      var g = await post({ target: 'en', workId: workId, chunk: { part: q } });
      if (g.status !== 200 || !g.json) break;
      Object.assign(back, g.json.items || {});
      if (q === 0) backChars = g.json.chars || {};
    }
    var bad = 0;
    got.items.forEach(function (kv) { if (back[kv[0]] !== kv[1]) bad++; });
    var badC = 0;
    Object.keys(got.chars).forEach(function (id) { if (backChars[id] !== got.chars[id]) badC++; });
    return { 分割数: total, 送った: got.items.length, 読み返した: Object.keys(back).length,
             食い違い: bad, 人物の食い違い: badC };
  }

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  (async function () {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;width:min(94vw,620px);'
      + 'max-height:88vh;overflow:auto;background:#fff;color:#111;z-index:2147483000;'
      + 'border:2px solid #6366F1;border-radius:12px;padding:16px 18px;'
      + 'box-shadow:0 10px 40px rgba(0,0,0,.3);font:14px/1.7 system-ui,sans-serif';
    box.innerHTML = '<div style="font-weight:700;font-size:1.05rem">英訳を壊れない置き場へ移す</div>'
      + '<div id="st" style="margin-top:8px">調べています…</div>';
    document.body.appendChild(box);
    var st = box.querySelector('#st');

    var cat = await fetch('/api/catalog', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
    var rows = (cat && cat.works) || [];
    if (!rows.length) { st.textContent = '作品の一覧が読めませんでした。'; return; }

    var list = [];
    for (var i = 0; i < rows.length; i++) {
      st.textContent = '調べています ' + (i + 1) + '/' + rows.length + '　' + (rows[i].title || rows[i].id);
      var p = await post({ probe: true, workId: rows[i].id });
      if (p.status === 401 || p.status === 403) {
        st.textContent = 'オーナーのアカウントでログインしてから実行してください (HTTP ' + p.status + ')';
        return;
      }
      if (!p.json) continue;
      list.push({ row: rows[i], probe: p.json, from: p.json['取り出し元'] || 'none' });
    }

    var need = list.filter(function (x) { return x.from === 'key'; });
    var safe = list.filter(function (x) { return x.from === 'chunk'; });
    var none = list.filter(function (x) { return x.from !== 'key' && x.from !== 'chunk'; });
    log('移す必要あり', need.length, '件 / すでに安全', safe.length, '件 / 訳なし', none.length, '件');

    var html = '<div style="font-weight:700;font-size:1.05rem">英訳を壊れない置き場へ移す</div>'
      + '<div style="margin:8px 0 12px;font-size:13px">訳の中身は1文字も変えません。'
      + '全文キー側も消さずに残します。置き場を増やすだけです。</div>';

    if (!need.length) {
      html += '<div style="padding:10px 0">移す必要のある作品はありません。'
        + 'すでに ' + safe.length + ' 件が安全な置き場にあります。</div>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;font-size:13px">'
        + '<tr style="text-align:left;border-bottom:1px solid #ddd">'
        + '<th>作品</th><th style="text-align:right">本文</th><th style="text-align:right">訳</th>'
        + '<th>判定</th><th></th></tr>';
      need.forEach(function (x, n) {
        html += '<tr style="border-bottom:1px solid #f0f0f0">'
          + '<td>' + esc(x.probe.title || x.row.title || x.row.id) + '</td>'
          + '<td style="text-align:right">' + x.probe.blocks + '</td>'
          + '<td style="text-align:right">' + x.probe['訳がある'] + '</td>'
          + '<td>' + esc(x.probe['判定']) + '</td>'
          + '<td><button data-n="' + n + '" class="pn" style="cursor:pointer">移す</button></td></tr>';
      });
      html += '</table>'
        + '<div style="margin-top:12px"><button id="all" style="padding:10px 14px;border-radius:8px;'
        + 'border:0;background:#6366F1;color:#fff;font-weight:700;cursor:pointer">'
        + '全部移す (' + need.length + '件)</button></div>';
    }
    if (safe.length) {
      html += '<div style="margin-top:10px;font-size:12px;color:#555">すでに安全: '
        + safe.map(function (x) { return esc(x.probe.title || x.row.title); }).join('、') + '</div>';
    }
    if (none.length) {
      html += '<div style="margin-top:6px;font-size:12px;color:#b45309">訳がまだ無い: '
        + none.map(function (x) { return esc(x.row.title); }).join('、') + '</div>';
    }
    html += '<div style="margin-top:14px"><button id="cl" style="padding:8px 14px;border-radius:8px;cursor:pointer">閉じる</button></div>'
      + '<pre id="lg" style="margin-top:10px;font-size:12px;white-space:pre-wrap"></pre>';
    box.innerHTML = html;
    var lg = box.querySelector('#lg');
    box.querySelector('#cl').onclick = function () { if (box.parentNode) box.parentNode.removeChild(box); };

    async function run(x, btn) {
      if (btn) { btn.disabled = true; btn.textContent = '読んでいます…'; }
      var name = x.probe.title || x.row.title || x.row.id;
      try {
        var got = await readAll(x.row.id);
        if (got.from !== 'key') { lg.textContent += name + ': すでに安全です。何もしません。\n';
          if (btn) btn.textContent = '不要'; return; }
        if (!got.items.length) { lg.textContent += name + ': 訳がありません。何もしません。\n';
          if (btn) btn.textContent = '訳なし'; return; }
        if (btn) btn.textContent = '写しています…';
        var res = await pin(x.row.id, got);
        var pr = await post({ probe: true, workId: x.row.id });
        var line = name + ': 写した ' + res['送った'] + ' 件 / 人物 '
          + Object.keys(got.chars).length + ' 名 / 食い違い ' + res['食い違い']
          + ' 件・人物 ' + res['人物の食い違い'] + ' 件\n'
          + '  点検: ' + (pr.json ? pr.json['判定'] + '（元=' + pr.json['取り出し元'] + '）' : 'HTTP ' + pr.status);
        lg.textContent += line + '\n';
        log(line);
        if (btn) btn.textContent = (res['食い違い'] === 0 && res['人物の食い違い'] === 0) ? '移しました' : '要確認';
      } catch (e) {
        lg.textContent += name + ': 失敗 — ' + ((e && e.message) || e) + '\n';
        warn(name, e);
        if (btn) { btn.disabled = false; btn.textContent = 'もう一度'; }
      }
    }

    box.querySelectorAll('.pn').forEach(function (btn) {
      btn.onclick = function () { run(need[+btn.getAttribute('data-n')], btn); };
    });
    var allBtn = box.querySelector('#all');
    if (allBtn) allBtn.onclick = async function () {
      if (!confirm(need.length + ' 件の英訳を、分割キャッシュへ写します。\n\n'
        + '訳の中身は変えません。全文キー側も残します。\n'
        + '長編があるので数分かかります。続けますか?')) return;
      allBtn.disabled = true;
      var btns = [].slice.call(box.querySelectorAll('.pn'));
      for (var n = 0; n < need.length; n++) {
        allBtn.textContent = '移しています… ' + (n + 1) + '/' + need.length;
        await run(need[n], btns[n]);
      }
      allBtn.textContent = '終わりました';
    };

    window.__anvPin = { list: list, need: need, safe: safe, none: none };
    log('パネルを出しました。window.__anvPin に結果が入っています。');
  })();
})();
