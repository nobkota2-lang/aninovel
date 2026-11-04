// 宛先の無くなった音声を消す
// ============================================================
//
// 何のために
//   音声は R2 に「作品ID/項目ID」(英語は「作品ID/en/項目ID」)で入っている。
//   項目IDは本文のブロックIDそのもの。作品を取り込み直すとブロックIDが
//   変わるので、前のIDで保存された音声はどのブロックからも参照されなく
//   なる。再生されることは二度と無く、容量と一覧だけを占める。
//   それを消すための道具。
//
// 判定の仕方
//   いま本文にあるブロックIDの一覧を /api/translate の dump から取り、
//   R2 の音声一覧(/api/audio/{作品ID})と引き算する。
//   本文に無いIDの音声が「宛先なし」。
//
// 安全のための決め事
//   ・本文が1件も読めなかった作品は「判定不能」にして、消す対象にしない。
//     ここを守らないと、本文の取得に失敗しただけで全部が孤児に見え、
//     全消去を提案してしまう。実際に点検(probe)で一度やりかけた失敗。
//   ・dump を最後の区画まで読み切れなかった作品も「判定不能」にする。
//     途中までのIDで引き算すると、読めていない分が孤児に見える。
//   ・消すのは項目IDを1件ずつ列挙したときだけ。
//     「前方一致」「言語まるごと」はサーバ側にも用意していない。
//   ・音声が全部孤児になる場合は、その旨を赤字で出す。
//     取り込み直しで全IDが変わったのなら正しいが、見ずに押す場所ではない。
//   ・消したあとマニフェストを読み直し、本当に消えたかを数える。
//   ・本文・英訳・人物には一切触れない。
//
// 使い方
//   aninovel.com をオーナーのアカウントで開き、コンソールに貼り付ける。
//   作品ごとに「対象を見る」→ 中身を確かめて「消す」。

(function () {
  'use strict';

  function log() { console.info.apply(console, ['[DELAUDIO]'].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, ['[DELAUDIO]'].concat([].slice.call(arguments))); }
  log('ローダー起動');

  // ---- 引き算の本体。ここだけは単体で試せるように副作用を持たせない ----
  //   manifest : {items:{id:{}}, itemsEn:{id:{}}}
  //   blockIds : 本文にあるIDの配列
  //   complete : dump を最後まで読み切れたか
  function orphansOf(manifest, blockIds, complete) {
    var have = Object.create(null);
    (blockIds || []).forEach(function (id) { if (id) have[String(id)] = true; });
    var nBlocks = Object.keys(have).length;
    var ja = Object.keys((manifest && manifest.items) || {});
    var en = Object.keys((manifest && manifest.itemsEn) || {});
    var total = ja.length + en.length;

    // 本文が読めていないなら判定しない。全部が孤児に見えるのを防ぐ。
    if (!complete || nBlocks === 0) {
      return { 判定不能: true, 理由: (nBlocks === 0 ? '本文のブロックが0件' : '本文を最後まで読めなかった'),
               音声: total, 対象: [], blocks: nBlocks };
    }
    var out = [];
    ja.forEach(function (id) { if (!have[id]) out.push({ lang: 'ja', itemId: id }); });
    en.forEach(function (id) { if (!have[id]) out.push({ lang: 'en', itemId: id }); });
    return { 判定不能: false, 音声: total, 対象: out, blocks: nBlocks,
             全部が対象: (total > 0 && out.length === total) };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { orphansOf: orphansOf }; return; }

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

  function getManifest(workId) {
    return fetch('/api/audio/' + encodeURIComponent(workId), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // 本文のブロックIDを全部読む。読み切れたかどうかも返す。
  async function readBlockIds(workId) {
    var ids = [], part = 0, complete = false, totalParts = null;
    for (;;) {
      var r = await post({ dump: { part: part, size: 1200 }, workId: workId, target: 'en' });
      if (r.status !== 200 || !r.json) return { ids: ids, complete: false, http: r.status };
      if (totalParts === null) totalParts = r.json.totalParts || 1;
      (r.json.blocks || []).forEach(function (b) { if (b && b.id) ids.push(String(b.id)); });
      part++;
      if (part >= totalParts) { complete = true; break; }
      if (part > 200) return { ids: ids, complete: false, http: 'too many parts' };
    }
    return { ids: ids, complete: complete };
  }

  async function del(workId, targets) {
    var r = await fetch('/api/audio/' + encodeURIComponent(workId), {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ items: targets }),
    });
    var t = await r.text(); var j = null; try { j = JSON.parse(t); } catch (e) {}
    return { status: r.status, json: j, text: t };
  }

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  (async function () {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;width:min(94vw,680px);'
      + 'max-height:88vh;overflow:auto;background:#fff;color:#111;z-index:2147483000;'
      + 'border:2px solid #DC2626;border-radius:12px;padding:16px 18px;'
      + 'box-shadow:0 10px 40px rgba(0,0,0,.3);font:14px/1.7 system-ui,sans-serif';
    box.innerHTML = '<div style="font-weight:700;font-size:1.05rem">宛先の無くなった音声を消す</div>'
      + '<div id="st" style="margin-top:8px">調べています…</div>';
    document.body.appendChild(box);
    var st = box.querySelector('#st');

    var cat = await fetch('/api/catalog', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
    var rows = (cat && cat.works) || [];
    if (!rows.length) { st.textContent = '作品の一覧が読めませんでした。'; return; }

    var list = [];
    for (var i = 0; i < rows.length; i++) {
      var nm = rows[i].title || rows[i].id;
      st.textContent = '調べています ' + (i + 1) + '/' + rows.length + '　' + nm;
      var man = await getManifest(rows[i].id);
      var nJa = Object.keys((man && man.items) || {}).length;
      var nEn = Object.keys((man && man.itemsEn) || {}).length;
      if (nJa + nEn === 0) { list.push({ row: rows[i], 音声: 0, res: null }); continue; }
      var bi = await readBlockIds(rows[i].id);
      if (bi.http === 401 || bi.http === 403) {
        st.textContent = 'オーナーのアカウントでログインしてから実行してください (HTTP ' + bi.http + ')';
        return;
      }
      list.push({ row: rows[i], 音声: nJa + nEn, ja: nJa, en: nEn,
                  res: orphansOf(man, bi.ids, bi.complete) });
    }

    var work = list.filter(function (x) { return x.res && !x.res['判定不能'] && x.res['対象'].length; });
    var clean = list.filter(function (x) { return x.res && !x.res['判定不能'] && !x.res['対象'].length; });
    var unknown = list.filter(function (x) { return x.res && x.res['判定不能']; });
    var noaudio = list.filter(function (x) { return !x.res; });
    log('対象あり', work.length, '/ 問題なし', clean.length, '/ 判定不能', unknown.length, '/ 音声なし', noaudio.length);

    var html = '<div style="font-weight:700;font-size:1.05rem">宛先の無くなった音声を消す</div>'
      + '<div style="margin:8px 0 12px;font-size:13px">本文にあるブロックIDと、R2 にある音声IDを'
      + '引き算した結果です。本文・英訳・人物には触れません。</div>';

    if (!work.length) {
      html += '<div style="padding:10px 0">消す対象のある作品はありません。</div>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;font-size:13px">'
        + '<tr style="text-align:left;border-bottom:1px solid #ddd"><th>作品</th>'
        + '<th style="text-align:right">本文</th><th style="text-align:right">音声</th>'
        + '<th style="text-align:right">宛先なし</th><th></th></tr>';
      work.forEach(function (x, n) {
        var all = x.res['全部が対象'];
        html += '<tr style="border-bottom:1px solid #f0f0f0">'
          + '<td>' + esc(x.row.title || x.row.id) + '</td>'
          + '<td style="text-align:right">' + x.res.blocks + '</td>'
          + '<td style="text-align:right">' + x.音声 + '</td>'
          + '<td style="text-align:right' + (all ? ';color:#DC2626;font-weight:700' : '') + '">'
          + x.res['対象'].length + (all ? '（全部）' : '') + '</td>'
          + '<td><button data-n="' + n + '" class="sh" style="cursor:pointer">対象を見る</button></td></tr>';
      });
      html += '</table>';
    }
    if (unknown.length) {
      html += '<div style="margin-top:10px;padding:8px 10px;background:#FEF3C7;border-radius:8px;font-size:12px">'
        + '判定不能（消す対象にしません）: '
        + unknown.map(function (x) { return esc(x.row.title) + '（' + esc(x.res['理由']) + '）'; }).join('、')
        + '</div>';
    }
    if (clean.length) {
      html += '<div style="margin-top:8px;font-size:12px;color:#555">問題なし: '
        + clean.map(function (x) { return esc(x.row.title); }).join('、') + '</div>';
    }
    if (noaudio.length) {
      html += '<div style="margin-top:6px;font-size:12px;color:#777">音声なし: '
        + noaudio.map(function (x) { return esc(x.row.title); }).join('、') + '</div>';
    }
    html += '<div id="dt" style="margin-top:12px"></div>'
      + '<div style="margin-top:14px"><button id="cl" style="padding:8px 14px;border-radius:8px;cursor:pointer">閉じる</button></div>'
      + '<pre id="lg" style="margin-top:10px;font-size:12px;white-space:pre-wrap"></pre>';
    box.innerHTML = html;
    var lg = box.querySelector('#lg'), dt = box.querySelector('#dt');
    box.querySelector('#cl').onclick = function () { if (box.parentNode) box.parentNode.removeChild(box); };

    function show(x) {
      var t = x.res['対象'];
      var h = '<div style="border:1px solid #DC2626;border-radius:8px;padding:10px 12px">'
        + '<div style="font-weight:700">' + esc(x.row.title || x.row.id) + '</div>'
        + '<div style="font-size:12px;margin:4px 0 8px">本文 ' + x.res.blocks + ' ブロック / '
        + '音声 ' + x.音声 + ' 件（日本語 ' + x.ja + '・英語 ' + x.en + '）/ '
        + '<b>宛先なし ' + t.length + ' 件</b></div>';
      if (x.res['全部が対象']) {
        h += '<div style="color:#DC2626;font-size:12px;margin-bottom:8px">'
          + 'この作品の音声はすべて対象です。取り込み直しで項目IDが全部変わった場合は正しい結果ですが、'
          + '本文の読み取りが想定と違う可能性もあります。IDの並びを確かめてから押してください。</div>';
      }
      h += '<div style="max-height:30vh;overflow:auto;background:#FAFAFA;border-radius:6px;padding:8px;'
        + 'font:12px/1.6 ui-monospace,monospace">'
        + t.map(function (o) { return esc(o.lang) + ' : ' + esc(o.itemId); }).join('<br>')
        + '</div>'
        + '<div style="margin-top:10px"><button id="go" style="padding:10px 14px;border-radius:8px;border:0;'
        + 'background:#DC2626;color:#fff;font-weight:700;cursor:pointer">この ' + t.length + ' 件を消す</button>'
        + ' <button id="no" style="padding:10px 14px;border-radius:8px;cursor:pointer">やめる</button></div></div>';
      dt.innerHTML = h;
      dt.querySelector('#no').onclick = function () { dt.innerHTML = ''; };
      dt.querySelector('#go').onclick = function () { run(x, dt.querySelector('#go')); };
      window.__anvDelTargets = t;
      log(x.row.title, '対象', t.length, '件 — window.__anvDelTargets に入れました');
    }

    async function run(x, btn) {
      var t = x.res['対象'], name = x.row.title || x.row.id;
      if (!confirm(name + ' の音声 ' + t.length + ' 件を R2 から消します。\n\n'
        + 'これは取り消せません。本文・英訳・人物は変わりません。\n続けますか?')) return;
      btn.disabled = true; btn.textContent = '消しています…';
      try {
        var done = 0, miss = 0, bad = [];
        for (var i = 0; i < t.length; i += 100) {
          var r = await del(x.row.id, t.slice(i, i + 100));
          if (r.status !== 200 || !r.json) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0, 160));
          done += r.json['消した'] || 0; miss += r.json['元から無かった'] || 0;
          (r.json.errors || []).forEach(function (e) { bad.push(e); });
        }
        // 読み直して確かめる
        var man2 = await getManifest(x.row.id);
        var left = 0;
        t.forEach(function (o) {
          var b = (o.lang === 'en') ? (man2 && man2.itemsEn) : (man2 && man2.items);
          if (b && b[o.itemId]) left++;
        });
        var line = name + ': 消した ' + done + ' 件 / 元から無かった ' + miss + ' 件 / '
          + '失敗 ' + bad.length + ' 件 / 読み直して残っていた ' + left + ' 件\n'
          + '  残りの音声: 日本語 ' + Object.keys((man2 && man2.items) || {}).length
          + ' 件・英語 ' + Object.keys((man2 && man2.itemsEn) || {}).length + ' 件';
        lg.textContent += line + '\n';
        log(line);
        if (bad.length) warn(name, bad);
        btn.textContent = (left === 0 && !bad.length) ? '消しました' : '要確認';
        x.res['対象'] = [];
      } catch (e) {
        lg.textContent += name + ': 失敗 — ' + ((e && e.message) || e) + '\n';
        warn(name, e);
        btn.disabled = false; btn.textContent = 'もう一度';
      }
    }

    box.querySelectorAll('.sh').forEach(function (btn) {
      btn.onclick = function () { show(work[+btn.getAttribute('data-n')]); };
    });

    window.__anvDelAudio = { list: list, work: work, clean: clean, unknown: unknown, noaudio: noaudio };
    log('パネルを出しました。window.__anvDelAudio に結果が入っています。');
  })();
})();
