// 迷子になった英訳を片付ける
// ============================================================
//
// 迷子とは
//   英訳の全文キーは「本文・ブロックid・人物名」から作る。本文を1文字
//   直すか、人物が1人増減するだけで鍵が変わり、前の訳は KV に残ったまま
//   誰からも参照されなくなる。それが迷子。
//
// 迷子＝不要ではない
//   その鍵にしか無い手訳なら、消せば二度と戻らない。だから消す前に
//   1件ずつ「同じ訳が現役の置き場にもあるか」を確かめる。
//   確かめ方は、迷子の中身と、その作品のいまの訳(分割キャッシュを先に
//   読む dump)を、ブロックidごとに文字列で突き合わせる。
//
//   全件一致            → 安全に消せる（ただの重複）
//   1件でも欠けるか違う → 消さない（書き戻しの候補）
//   作品が特定できない  → 消さない（判定不能）
//
// 退避が先
//   「安全」と出たものでも、消す前に全迷子の中身をファイルへ落とす。
//   退避していない状態では削除ボタンを押せないようにしてある。
//   判定の仕組みに穴があっても、ファイルがあれば戻せる。
//
// サーバ側の砦
//   /api/translate の orphans.delete は、鍵を1つずつ列挙したときだけ
//   消す。前方一致も「全部」も無い。生きている鍵を渡しても消さずに
//   拒否して返す。判定を道具の側だけに任せていない。
//
// 使い方
//   aninovel.com をオーナーのアカウントで開き、コンソールに貼り付ける。
//   ①調べる → ②ファイルに退避 → ③中身を見る → ④安全なものだけ消す

(function () {
  'use strict';

  function log() { console.info.apply(console, ['[DELTR]'].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, ['[DELTR]'].concat([].slice.call(arguments))); }
  log('ローダー起動');

  // ---- 突き合わせの本体。副作用を持たせず、単体で試せるようにする ----
  //   orphan  : { title, items:[{id,text}], characters }
  //   current : { id: 英訳文 }   その作品のいまの訳
  //   found   : 作品が特定できたか
  function classify(orphan, current, found) {
    var its = (orphan && Array.isArray(orphan.items)) ? orphan.items : [];
    if (!found || !current) {
      return { 判定: '判定不能', 理由: '作品を特定できませんでした',
               件数: its.length, 欠け: null, 違い: null, 消せる: false };
    }
    if (!its.length) {
      // 中身が空の鍵。失うものが無いので消してよい。
      return { 判定: '安全に消せる', 理由: '中身が空です',
               件数: 0, 欠け: 0, 違い: 0, 消せる: true };
    }
    var missing = 0, differs = 0, samples = [];
    for (var i = 0; i < its.length; i++) {
      var it = its[i]; if (!it || !it.id) continue;
      var now = current[it.id];
      if (now === undefined || now === null || now === '') {
        missing++;
        if (samples.length < 3) samples.push({ id: it.id, 状態: '現役側に無い',
          迷子: String(it.text || '').slice(0, 60) });
        continue;
      }
      if (String(now) !== String(it.text == null ? '' : it.text)) {
        differs++;
        if (samples.length < 3) samples.push({ id: it.id, 状態: '文字列が違う',
          迷子: String(it.text || '').slice(0, 60), 現役: String(now).slice(0, 60) });
      }
    }
    if (missing === 0 && differs === 0) {
      return { 判定: '安全に消せる', 理由: '全' + its.length + '件が現役の置き場にも同じ文字列で在ります',
               件数: its.length, 欠け: 0, 違い: 0, 消せる: true, 見本: [] };
    }
    return { 判定: '消すと失われる',
             理由: '欠け ' + missing + ' 件・文字列の違い ' + differs + ' 件',
             件数: its.length, 欠け: missing, 違い: differs, 消せる: false, 見本: samples };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { classify: classify }; return; }

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

  // いまの訳を全部読む(分割キャッシュを先に読む経路)
  async function readCurrent(workId) {
    var cur = Object.create(null), part = 0, total = null, from = null, blocks = 0;
    for (;;) {
      var r = await post({ dump: { part: part, size: 1200 }, workId: workId, target: 'en' });
      if (r.status !== 200 || !r.json) return { ok: false, http: r.status };
      if (total === null) { total = r.json.totalParts || 1; from = r.json.from; }
      (r.json.blocks || []).forEach(function (b) {
        if (b && b.id) { blocks++; if (b.en != null && b.en !== '') cur[String(b.id)] = String(b.en); }
      });
      part++;
      if (part >= total) break;
      if (part > 200) return { ok: false, http: 'too many parts' };
    }
    return { ok: true, cur: cur, from: from, blocks: blocks };
  }

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function save(name, obj) {
    var b = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    var u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(u); }, 4000);
  }

  (async function () {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;width:min(94vw,760px);'
      + 'max-height:90vh;overflow:auto;background:#fff;color:#111;z-index:2147483000;'
      + 'border:2px solid #B45309;border-radius:12px;padding:16px 18px;'
      + 'box-shadow:0 10px 40px rgba(0,0,0,.3);font:14px/1.7 system-ui,sans-serif';
    box.innerHTML = '<div style="font-weight:700;font-size:1.05rem">迷子になった英訳</div>'
      + '<div id="st" style="margin-top:8px">鍵を並べています…</div>';
    document.body.appendChild(box);
    var st = box.querySelector('#st');

    // ① 迷子の鍵を全部並べる
    var keys = [], cursor = null, pages = 0, liveCount = 0;
    for (;;) {
      var r = await post({ orphans: { limit: 1, cursor: cursor }, target: 'en' });
      if (r.status === 401 || r.status === 403) {
        st.textContent = 'オーナーのアカウントでログインしてから実行してください (HTTP ' + r.status + ')';
        return;
      }
      if (r.status !== 200 || !r.json) { st.textContent = '一覧が読めませんでした (HTTP ' + r.status + ')'; return; }
      (r.json['迷子の鍵'] || []).forEach(function (k) { keys.push(k); });
      liveCount = r.json['生きている鍵'] || liveCount;
      cursor = r.json.cursor; pages++;
      st.textContent = '鍵を並べています… 迷子 ' + keys.length + ' 件';
      if (!r.json['続きがある'] || !cursor || pages > 60) break;
    }
    keys = keys.filter(function (k, i) { return keys.indexOf(k) === i; });
    log('迷子', keys.length, '件 / 生きている鍵', liveCount, '件');

    if (!keys.length) {
      box.innerHTML = '<div style="font-weight:700">迷子になった英訳</div>'
        + '<div style="margin-top:10px">迷子はありません。生きている鍵 ' + liveCount + ' 件。</div>'
        + '<div style="margin-top:14px"><button id="cl" style="padding:8px 14px;border-radius:8px;cursor:pointer">閉じる</button></div>';
      box.querySelector('#cl').onclick = function () { box.remove(); };
      return;
    }

    // ② 作品の一覧と、いまの訳を用意する
    var cat = await fetch('/api/catalog', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (x) { return x.json(); }).catch(function () { return null; });
    var works = (cat && cat.works) || [];
    var curCache = Object.create(null);

    // ③ 1件ずつ中身を読んで突き合わせる
    var rows = [];
    for (var i = 0; i < keys.length; i++) {
      st.textContent = '中身を確かめています ' + (i + 1) + '/' + keys.length;
      var g = await post({ orphans: { key: keys[i] }, target: 'en' });
      var v = (g.status === 200) ? g.json : null;
      if (!v) { rows.push({ key: keys[i], orphan: null,
        res: { 判定: '判定不能', 理由: '中身が読めません (HTTP ' + g.status + ')', 消せる: false, 件数: 0 } });
        continue; }
      var its = Array.isArray(v.items) ? v.items : [];

      // 作品を特定する。まず題名、次にブロックidの重なり。
      var w = works.find(function (x) { return x && v.title && x.title === v.title; }) || null;
      if (!w && its.length) {
        var ids = Object.create(null);
        its.forEach(function (it) { if (it && it.id) ids[String(it.id)] = true; });
        var best = null, bestN = 0;
        for (var n = 0; n < works.length; n++) {
          if (!curCache[works[n].id]) curCache[works[n].id] = await readCurrent(works[n].id);
          var c = curCache[works[n].id];
          if (!c.ok) continue;
          var hit = 0;
          for (var k2 in c.cur) if (ids[k2]) hit++;
          if (hit > bestN) { bestN = hit; best = works[n]; }
        }
        if (bestN > 0) w = best;
      }
      var cur = null, found = false;
      if (w) {
        if (!curCache[w.id]) curCache[w.id] = await readCurrent(w.id);
        if (curCache[w.id].ok) { cur = curCache[w.id].cur; found = true; }
      }
      rows.push({ key: keys[i], orphan: v, work: w,
                  res: classify({ title: v.title, items: its }, cur, found) });
    }

    var safe = rows.filter(function (x) { return x.res['消せる']; });
    var lose = rows.filter(function (x) { return x.res['判定'] === '消すと失われる'; });
    var unk  = rows.filter(function (x) { return x.res['判定'] === '判定不能'; });
    log('安全', safe.length, '/ 失われる', lose.length, '/ 判定不能', unk.length);

    var backedUp = false;
    function render() {
      var h = '<div style="font-weight:700;font-size:1.05rem">迷子になった英訳</div>'
        + '<div style="margin:8px 0 10px;font-size:13px">迷子 ' + rows.length + ' 件 / '
        + '生きている鍵 ' + liveCount + ' 件。迷子の中身と、その作品のいまの訳を'
        + 'ブロックidごとに文字列で突き合わせました。</div>'
        + '<table style="width:100%;border-collapse:collapse;font-size:13px">'
        + '<tr style="text-align:left;border-bottom:1px solid #ddd"><th>判定</th><th>作品</th>'
        + '<th style="text-align:right">件数</th><th>理由</th><th></th></tr>';
      rows.forEach(function (x, n) {
        var col = x.res['消せる'] ? '#15803D' : (x.res['判定'] === '消すと失われる' ? '#DC2626' : '#B45309');
        h += '<tr style="border-bottom:1px solid #f0f0f0">'
          + '<td style="color:' + col + ';font-weight:700;white-space:nowrap">' + esc(x.res['判定']) + '</td>'
          + '<td>' + esc((x.orphan && x.orphan.title) || (x.work && x.work.title) || '—') + '</td>'
          + '<td style="text-align:right">' + (x.res['件数'] || 0) + '</td>'
          + '<td style="font-size:12px">' + esc(x.res['理由']) + '</td>'
          + '<td><button data-n="' + n + '" class="sh" style="cursor:pointer">中身</button></td></tr>';
      });
      h += '</table>';
      h += '<div style="margin-top:12px;padding:10px 12px;background:#FEF3C7;border-radius:8px">'
        + '<div style="font-weight:700">まずファイルへ退避します</div>'
        + '<div style="font-size:12px;margin:4px 0 8px">迷子 ' + rows.length + ' 件の中身を'
        + 'すべて JSON に落とします。退避しないと削除ボタンは押せません。</div>'
        + '<button id="bk" style="padding:10px 14px;border-radius:8px;border:0;background:#B45309;'
        + 'color:#fff;font-weight:700;cursor:pointer">退避ファイルを保存</button>'
        + (backedUp ? ' <span style="color:#15803D;font-weight:700">保存しました</span>' : '')
        + '</div>';
      if (safe.length) {
        h += '<div style="margin-top:10px">'
          + '<button id="go" ' + (backedUp ? '' : 'disabled ')
          + 'style="padding:10px 14px;border-radius:8px;border:0;background:'
          + (backedUp ? '#DC2626' : '#CCC') + ';color:#fff;font-weight:700;cursor:'
          + (backedUp ? 'pointer' : 'not-allowed') + '">安全な ' + safe.length + ' 件を消す</button>'
          + '<span style="font-size:12px;margin-left:8px">'
          + (backedUp ? '' : '（先に退避ファイルを保存してください）') + '</span></div>';
      } else {
        h += '<div style="margin-top:10px;padding:8px 10px;background:#F3F4F6;border-radius:8px;font-size:13px">'
          + '安全に消せる鍵はありません。消すと失われるもの ' + lose.length + ' 件、'
          + '判定不能 ' + unk.length + ' 件。どちらも消しません。</div>';
      }
      h += '<div id="dt" style="margin-top:12px"></div>'
        + '<div style="margin-top:14px"><button id="cl" style="padding:8px 14px;border-radius:8px;cursor:pointer">閉じる</button></div>'
        + '<pre id="lg" style="margin-top:10px;font-size:12px;white-space:pre-wrap"></pre>';
      box.innerHTML = h;
      box.querySelector('#cl').onclick = function () { box.remove(); };
      box.querySelector('#bk').onclick = function () {
        save('aninovel_orphan_tr_' + new Date().toISOString().slice(0, 10) + '.json', {
          保存日時: new Date().toISOString(), 迷子の件数: rows.length,
          生きている鍵: liveCount,
          迷子: rows.map(function (x) {
            return { key: x.key, 判定: x.res['判定'], 理由: x.res['理由'],
                     作品: (x.work && x.work.id) || null, 中身: x.orphan };
          }),
        });
        backedUp = true; render();
        log('退避ファイルを保存しました');
      };
      var go = box.querySelector('#go');
      if (go) go.onclick = function () { run(go); };
      box.querySelectorAll('.sh').forEach(function (b) {
        b.onclick = function () { show(rows[+b.getAttribute('data-n')]); };
      });
    }

    function show(x) {
      var d = box.querySelector('#dt');
      var its = (x.orphan && Array.isArray(x.orphan.items)) ? x.orphan.items : [];
      var h = '<div style="border:1px solid #B45309;border-radius:8px;padding:10px 12px">'
        + '<div style="font-weight:700">' + esc((x.orphan && x.orphan.title) || '—') + '</div>'
        + '<div style="font-size:12px;margin:4px 0">' + esc(x.key) + '</div>'
        + '<div style="font-size:13px;margin-bottom:6px">' + esc(x.res['判定']) + ' — ' + esc(x.res['理由']) + '</div>';
      if (x.res['見本'] && x.res['見本'].length) {
        h += '<div style="font-size:12px;background:#FEE2E2;border-radius:6px;padding:8px;margin-bottom:8px">'
          + x.res['見本'].map(function (s) {
            return esc(s.id) + ' ' + esc(s.状態) + '<br>　迷子: ' + esc(s.迷子)
              + (s.現役 ? '<br>　現役: ' + esc(s.現役) : '');
          }).join('<hr style="border:0;border-top:1px solid #FCA5A5">') + '</div>';
      }
      h += '<div style="max-height:28vh;overflow:auto;background:#FAFAFA;border-radius:6px;padding:8px;'
        + 'font:12px/1.6 ui-monospace,monospace">'
        + its.slice(0, 40).map(function (it) {
          return esc(it && it.id) + ' : ' + esc(String((it && it.text) || '').slice(0, 90));
        }).join('<br>')
        + (its.length > 40 ? '<br>… 残り ' + (its.length - 40) + ' 件' : '')
        + '</div></div>';
      d.innerHTML = h;
      window.__anvOrphan = x;
      log('window.__anvOrphan に入れました');
    }

    async function run(btn) {
      if (!backedUp) return;
      var ks = safe.map(function (x) { return x.key; });
      if (!confirm('迷子の英訳 ' + ks.length + ' 件を KV から消します。\n\n'
        + 'いずれも「同じ訳が現役の置き場にも同じ文字列で在る」と確かめたものです。\n'
        + '退避ファイルは保存済みです。これは取り消せません。\n続けますか?')) return;
      btn.disabled = true; btn.textContent = '消しています…';
      var lg = box.querySelector('#lg');
      try {
        var done = 0, refused = 0, miss = 0, bad = [];
        for (var i = 0; i < ks.length; i += 100) {
          var r = await post({ orphans: { delete: ks.slice(i, i + 100) }, target: 'en' });
          if (r.status !== 200 || !r.json) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0, 160));
          done += r.json['消した'] || 0;
          refused += r.json['生きているので拒否'] || 0;
          miss += r.json['元から無かった'] || 0;
          (r.json.failed || []).forEach(function (e) { bad.push(e); });
          (r.json.badForm || []).forEach(function (e) { bad.push({ key: e, 理由: '形が不正' }); });
        }
        // 読み直して確かめる
        var after = await post({ orphans: { limit: 1 }, target: 'en' });
        var line = '消した ' + done + ' 件 / 生きているので拒否 ' + refused + ' 件 / '
          + '元から無かった ' + miss + ' 件 / 失敗 ' + bad.length + ' 件\n'
          + '  いまの迷子: ' + (after.json ? after.json['内_迷子'] : '?') + ' 件（この頁）'
          + ' / 生きている鍵: ' + (after.json ? after.json['生きている鍵'] : '?') + ' 件';
        lg.textContent += line + '\n';
        log(line);
        if (refused) warn('生きていると判定されて拒否された鍵があります。道具側の判定とサーバ側の判定が食い違っています。');
        if (bad.length) warn(bad);
        btn.textContent = (bad.length === 0) ? '消しました' : '要確認';
      } catch (e) {
        lg.textContent += '失敗 — ' + ((e && e.message) || e) + '\n';
        warn(e);
        btn.disabled = false; btn.textContent = 'もう一度';
      }
    }

    render();
    window.__anvDelTr = { rows: rows, safe: safe, lose: lose, unk: unk, liveCount: liveCount };
    log('パネルを出しました。window.__anvDelTr に結果が入っています。');
  })();
})();
