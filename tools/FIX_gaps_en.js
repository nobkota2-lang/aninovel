// 英訳の穴を、迷子から埋める
// ============================================================
//
// RECOVER_en.js との違い
//   RECOVER は「迷子ごとに、いちばん重なる作品」を探す道具で、
//   作品まるごとを拾い直すためのもの。重なりが8割を下回る迷子は
//   扱わない。だから綺堂むかし語りのように「1,664件のうち4件だけ
//   日本語が残っている」という状態は埋められなかった。
//
//   こちらは逆から行く。まず穴(訳が無い・原文が残っている)を
//   特定し、そのブロックidを持つ迷子を全部から探す。
//   穴の分だけを拾うので、重なり率を見る必要がない。
//
// 安全性
//   ・穴の開いているブロックにしか書かない。いまある訳は触らない
//   ・迷子側にも原文が残っている訳は採らない
//   ・書き込み先は分割キャッシュだけ(作品IDが鍵なので孤児化しない)
//   ・本文・人物・話者は変えない
//   ・送ったあと読み返して食い違いを数える
//   ・埋まらなかった穴は、原文つきで一覧に出す(そこは人が訳すしかない)
//
// 使い方
//   aninovel.com をオーナーのアカウントで開き、コンソールに貼り付ける。
//   穴のある作品だけを調べるので、健全な作品は読みに行かない。

(function () {
  'use strict';

  var CHUNK = 1000;
  function log() { console.info.apply(console, ['[GAPS]'].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, ['[GAPS]'].concat([].slice.call(arguments))); }
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

  function reFor(src) {
    return (src === 'ko') ? /[가-힯]/ : /[぀-ヿ㐀-鿿]/;
  }

  // いまの訳を全部読み、穴を洗い出す
  async function gapsOf(workId) {
    var cur = Object.create(null), curChars = Object.create(null);
    var blocks = [], chars = [], part = 0, from = null, src = 'ja', title = '';
    for (;;) {
      var r = await post({ dump: { part: part, size: 1200 }, workId: workId, target: 'en' });
      if (r.status !== 200 || !r.json) break;
      from = r.json.from; src = r.json.sourceLang || 'ja'; title = r.json.title || '';
      (r.json.blocks || []).forEach(function (b) {
        blocks.push(b);
        if (b && b.en != null && b.en !== '') cur[b.id] = String(b.en);
      });
      if (part === 0) {
        chars = r.json.chars || [];
        chars.forEach(function (c) { if (c && c.en) curChars[c.id] = String(c.en); });
      }
      part++;
      if (part >= (r.json.totalParts || 1)) break;
    }
    var re = reFor(src);
    var holes = blocks.filter(function (b) {
      var en = cur[b.id];
      return (en == null || en === '' || re.test(en));
    });
    var charHoles = chars.filter(function (c) {
      var en = curChars[c.id];
      return (en == null || en === '' || re.test(en));
    });
    return { workId: workId, title: title, src: src, from: from,
             blocks: blocks, cur: cur, curChars: curChars,
             holes: holes, charHoles: charHoles };
  }

  (async function () {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;width:min(94vw,660px);'
      + 'max-height:88vh;overflow:auto;background:#fff;color:#111;z-index:2147483000;'
      + 'border:2px solid #6366F1;border-radius:12px;padding:16px 18px;'
      + 'box-shadow:0 10px 40px rgba(0,0,0,.3);font:14px/1.7 system-ui,sans-serif';
    box.innerHTML = '<div style="font-weight:700;font-size:1.05rem">英訳の穴埋め</div>'
      + '<div id="st" style="margin-top:8px">点検しています…</div>';
    document.body.appendChild(box);
    var st = box.querySelector('#st');

    // 1. 穴のある作品を探す
    var cat = await fetch('/api/catalog', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
    var rows = (cat && cat.works) || [];
    if (!rows.length) { st.textContent = '作品の一覧が読めませんでした。'; return; }

    var sick = [];
    for (var i = 0; i < rows.length; i++) {
      st.textContent = '点検 ' + (i + 1) + '/' + rows.length + '　' + (rows[i].title || rows[i].id);
      var p = await post({ probe: true, workId: rows[i].id });
      if (p.status === 401 || p.status === 403) {
        st.textContent = 'オーナーのアカウントでログインしてから実行してください (HTTP ' + p.status + ')';
        return;
      }
      if (!p.json) continue;
      if (p.json['判定'] !== '健全') sick.push({ row: rows[i], probe: p.json });
    }
    log('穴のある作品', sick.length, '件');
    if (!sick.length) {
      st.innerHTML = '穴はありませんでした。全作品が健全です。';
      return;
    }

    // 2. 迷子を並べる(中身は必要なものだけ読む)
    st.textContent = '迷子を探しています…';
    var orph = await post({ orphans: { limit: 1 } });
    var keys = (orph.json && orph.json['迷子の鍵']) || [];
    log('迷子', keys.length, '件');

    // 3. 作品ごとに穴を洗い、迷子から候補を集める
    var plans = [];
    for (var s = 0; s < sick.length; s++) {
      var id = sick[s].row.id;
      st.textContent = (sick[s].row.title || id) + ' の穴を調べています…';
      var g = await gapsOf(id);
      var want = Object.create(null);
      g.holes.forEach(function (b) { want[b.id] = 1; });
      var wantC = Object.create(null);
      g.charHoles.forEach(function (c) { wantC[c.id] = 1; });
      var re = reFor(g.src);

      var fill = Object.create(null), fillC = Object.create(null), sources = {};
      for (var k = 0; k < keys.length && (g.holes.length || g.charHoles.length); k++) {
        if (!Object.keys(want).length && !Object.keys(wantC).length) break;
        st.textContent = (g.title || id) + ' — 迷子 ' + (k + 1) + '/' + keys.length + ' を見ています…';
        var v = await post({ orphans: { key: keys[k] } });
        if (v.status !== 200 || !v.json) continue;
        var o = v.json;
        var used = 0;
        (o.items || []).forEach(function (x) {
          if (!x || !x.id || x.text == null || x.text === '') return;
          if (!Object.prototype.hasOwnProperty.call(want, x.id)) return;
          if (Object.prototype.hasOwnProperty.call(fill, x.id)) return;
          if (re.test(String(x.text))) return;           // 迷子側も原文のまま
          fill[x.id] = String(x.text); used++;
        });
        (o.characters || []).forEach(function (c) {
          if (!c || !c.id || !c.name) return;
          if (!Object.prototype.hasOwnProperty.call(wantC, c.id)) return;
          if (Object.prototype.hasOwnProperty.call(fillC, c.id)) return;
          if (re.test(String(c.name))) return;
          fillC[c.id] = String(c.name); used++;
        });
        if (used) sources[keys[k]] = { 題: o.title || '', 使えた: used };
      }
      plans.push({ work: sick[s], gaps: g, fill: fill, fillC: fillC, sources: sources });
    }

    // 4. 一覧
    function esc(x) {
      return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    var html = '<div style="font-weight:700;font-size:1.05rem">英訳の穴埋め</div>'
      + '<div style="margin:8px 0 12px;font-size:13px">穴の開いているブロックにだけ書きます。'
      + 'いまある訳は触りません。書き込み先は分割キャッシュです。</div>';
    plans.forEach(function (pl, n) {
      var nf = Object.keys(pl.fill).length, nc = Object.keys(pl.fillC).length;
      html += '<div style="border-top:1px solid #ddd;padding-top:10px;margin-top:10px">'
        + '<div style="font-weight:700">' + esc(pl.gaps.title || pl.work.row.id) + '</div>'
        + '<div style="font-size:13px">本文 ' + pl.gaps.blocks.length + ' 件 / '
        + '穴 ' + pl.gaps.holes.length + ' 件（うち迷子から埋まる <b>' + nf + '</b> 件）'
        + ' / 人物の穴 ' + pl.gaps.charHoles.length + ' 名（埋まる <b>' + nc + '</b> 名）'
        + ' / 置き場=' + esc(pl.gaps.from) + '</div>';
      if (Object.keys(pl.sources).length) {
        html += '<div style="font-size:12px;color:#555">拾い元: '
          + Object.keys(pl.sources).map(function (kk) {
              return esc(pl.sources[kk]['題'] || kk.slice(-12)) + '(' + pl.sources[kk]['使えた'] + ')';
            }).join(' / ') + '</div>';
      }
      // 埋まらない穴を、原文つきで見せる。人が訳すしかない分。
      var left = pl.gaps.holes.filter(function (b) {
        return !Object.prototype.hasOwnProperty.call(pl.fill, b.id);
      });
      if (left.length) {
        html += '<details style="margin-top:6px"><summary style="cursor:pointer;font-size:12.5px">'
          + '埋まらない穴 ' + left.length + ' 件（原文を表示）</summary>'
          + '<ol style="font-size:12px;margin:6px 0 0 1.2em">'
          + left.slice(0, 40).map(function (b) {
              return '<li><code>' + esc(b.id) + '</code> ' + esc(String(b.ja).slice(0, 160))
                + (b.en ? '<br><span style="color:#b45309">いまの訳: ' + esc(String(b.en).slice(0, 160)) + '</span>' : '')
                + '</li>';
            }).join('')
          + '</ol>' + (left.length > 40 ? '<div style="font-size:12px">…他 ' + (left.length - 40) + ' 件</div>' : '')
          + '</details>';
      }
      var leftC = pl.gaps.charHoles.filter(function (c) {
        return !Object.prototype.hasOwnProperty.call(pl.fillC, c.id);
      });
      if (leftC.length) {
        html += '<div style="font-size:12px;margin-top:4px;color:#b45309">英名の無い人物: '
          + leftC.map(function (c) { return esc(c.ja); }).join('、') + '</div>';
      }
      html += (nf + nc)
        ? '<div style="margin-top:8px"><button data-n="' + n + '" class="gf" '
          + 'style="cursor:pointer;font-weight:700;padding:8px 14px;border-radius:8px;'
          + 'border:0;background:#6366F1;color:#fff">穴を埋める</button></div>'
        : '<div style="margin-top:8px;font-size:12px;color:#777">迷子から埋められるものはありません。</div>';
      html += '</div>';
    });
    html += '<div style="margin-top:14px"><button id="cl" style="padding:8px 14px;border-radius:8px;cursor:pointer">閉じる</button></div>'
      + '<pre id="lg" style="margin-top:10px;font-size:12px;white-space:pre-wrap"></pre>';
    box.innerHTML = html;
    var lg = box.querySelector('#lg');
    box.querySelector('#cl').onclick = function () { if (box.parentNode) box.parentNode.removeChild(box); };

    box.querySelectorAll('.gf').forEach(function (btn) {
      btn.onclick = async function () {
        var pl = plans[+btn.getAttribute('data-n')];
        var nf = Object.keys(pl.fill).length, nc = Object.keys(pl.fillC).length;
        if (!confirm((pl.gaps.title || pl.work.row.id) + '\n\n'
          + '本文の穴 ' + nf + ' 件 と 人物 ' + nc + ' 名 を埋めます。\n'
          + 'いまある訳は上書きしません。\n続けますか?')) return;
        btn.disabled = true; btn.textContent = '書き込んでいます…';
        try {
          // いまの訳 ＋ 穴埋め を、まとめて分割キャッシュへ置き直す
          var pairs = [];
          pl.gaps.blocks.forEach(function (b) {
            if (Object.prototype.hasOwnProperty.call(pl.fill, b.id)) { pairs.push([b.id, pl.fill[b.id]]); return; }
            var now = pl.gaps.cur[b.id];
            if (now != null && now !== '') pairs.push([b.id, now]);
          });
          var chars = {};
          Object.keys(pl.gaps.curChars).forEach(function (id) { chars[id] = pl.gaps.curChars[id]; });
          Object.keys(pl.fillC).forEach(function (id) { chars[id] = pl.fillC[id]; });

          var total = Math.ceil(pairs.length / CHUNK);
          for (var p = 0; p < total; p++) {
            var slice = pairs.slice(p * CHUNK, p * CHUNK + CHUNK);
            var items = {};
            slice.forEach(function (kv) { items[kv[0]] = kv[1]; });
            var r = await post({ target: 'en', workId: pl.work.row.id,
              titleTr: pl.work.probe.titleTr || '', authorTr: '',
              chunk: { write: true, part: p, total: total, items: items,
                       chars: (p === 0 ? chars : {}) } });
            if (r.status !== 200 || !r.json || !r.json.ok) {
              throw new Error('part ' + p + ': HTTP ' + r.status + ' ' + r.text.slice(0, 120));
            }
          }
          // 読み返す
          var back = {};
          for (var q = 0; q < total; q++) {
            var g2 = await post({ target: 'en', workId: pl.work.row.id, chunk: { part: q } });
            if (g2.status !== 200 || !g2.json) break;
            Object.assign(back, g2.json.items || {});
          }
          var bad = 0;
          pairs.forEach(function (kv) { if (back[kv[0]] !== kv[1]) bad++; });
          var pr = await post({ probe: true, workId: pl.work.row.id });
          var line = (pl.gaps.title || pl.work.row.id) + ': 埋めた ' + nf + ' 件 / 人物 ' + nc
            + ' 名 / 送った ' + pairs.length + ' 件 / 食い違い ' + bad + ' 件\n'
            + '  点検: ' + (pr.json ? pr.json['判定'] + '（元=' + pr.json['取り出し元']
              + ' 訳がある=' + pr.json['訳がある'] + '/' + pr.json.blocks
              + ' 原文のまま=' + pr.json['原文のまま'] + ' 人物未訳=' + pr.json['人物名が未訳'] + '）'
              : 'HTTP ' + pr.status);
          lg.textContent += line + '\n';
          log(line);
          btn.textContent = bad === 0 ? '埋めました' : '要確認';
        } catch (e) {
          lg.textContent += '失敗: ' + ((e && e.message) || e) + '\n';
          warn(e);
          btn.disabled = false; btn.textContent = 'もう一度';
        }
      };
    });

    window.__anvGaps = { plans: plans, sick: sick, orphanKeys: keys };
    log('パネルを出しました。window.__anvGaps に結果が入っています。');
  })();
})();
