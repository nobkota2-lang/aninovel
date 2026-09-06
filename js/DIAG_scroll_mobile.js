/* =========================================================================
   AniNovel  スマホで追従スクロールが動かない原因を測る  DIAG_scroll_mobile.js
   ------------------------------------------------------------------------
   スマホではコンソールが見られないので、画面下に結果を重ねて表示する。

   viewer.html の末尾に一時的に
       <script src="js/DIAG_scroll_mobile.js"></script>
   を足して確認し、済んだら外してください。

   何を測るか
     ・実際にスクロールしている要素はどれか(#pageArea か、ページ全体か)
     ・カラオケが有効か
     ・追従の目標 _kara.want が立っているか
     ・「手動スクロール直後は休む」判定に引っかかり続けていないか
     ・毎フレーム scrollTop を書いているのに位置が変わっていないか
   ========================================================================= */
(function () {
  'use strict';
  if (window.__SDIAG) { window.__SDIAG.show(); return; }
  var box, pre, timer = null, L = [];

  function ui () {
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:44%;z-index:2147483647;'
      + 'background:#fff;border-top:3px solid #b91c1c;display:flex;flex-direction:column;'
      + 'font-family:-apple-system,sans-serif;font-size:12px';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;padding:6px;background:#fee2e2';
    function mk (t, fn) {
      var b = document.createElement('button');
      b.textContent = t;
      b.style.cssText = 'flex:1;padding:9px;font-size:12px;border:0;border-radius:6px;background:#b91c1c;color:#fff';
      b.onclick = fn; bar.appendChild(b);
    }
    mk('いま調べる', once);
    mk('5秒間 記録', watch);
    mk('消す', function () { if (timer) { clearInterval(timer); timer = null; } box.style.display = 'none'; });
    pre = document.createElement('div');
    pre.style.cssText = 'flex:1;overflow:auto;padding:8px;white-space:pre-wrap;word-break:break-all';
    box.appendChild(bar); box.appendChild(pre);
    document.body.appendChild(box);
  }
  function P (s) { L.push(String(s)); pre.textContent = L.join('\n'); pre.scrollTop = pre.scrollHeight; }

  function scrollers () {
    var out = [];
    var pa = document.getElementById('pageArea');
    if (pa) out.push({ name: '#pageArea', el: pa });
    var de = document.scrollingElement || document.documentElement;
    if (de) out.push({ name: 'ページ全体', el: de });
    if (document.body) out.push({ name: 'body', el: document.body });
    var wrap = pa && pa.firstElementChild;
    if (wrap) out.push({ name: '本文ラッパ', el: wrap });
    return out;
  }

  function once () {
    L = [];
    P('=== いまの状態 ===');
    P('VER: ' + (window.__ANINOVEL_VER__ || '?'));
    P('画面: ' + window.innerWidth + 'x' + window.innerHeight);
    P('');
    P('[スクロールできる要素]');
    scrollers().forEach(function (s) {
      var e = s.el;
      var can = e.scrollHeight > e.clientHeight + 4;
      P('  ' + (can ? '● ' : '　 ') + s.name
        + '  client=' + Math.round(e.clientHeight)
        + ' scroll=' + Math.round(e.scrollHeight)
        + ' top=' + Math.round(e.scrollTop)
        + (can ? '  ← ここが動く' : '  (動かない)'));
    });
    P('');
    P('[読み上げと追従]');
    try {
      P('  読み上げ中 : ' + !!(state.tts && state.tts.active));
      P('  カラオケ   : ' + !!(state.tts && state.tts.karaoke));
    } catch (e) { P('  state が読めません'); }
    try {
      var k = window._kara || {};
      P('  _kara.want : ' + (k.want == null ? 'なし(目標が立っていない)' : Math.round(k.want)));
      P('  掴んだ要素 : ' + (k.box ? 'あり' : 'なし'));
      P('  文の区切り : ' + ((k.spans && k.spans.length) || 0));
      P('  raf        : ' + (k.raf ? '回っている' : '止まっている'));
      var age = k.userAt ? (Date.now() - k.userAt) : null;
      P('  手動操作から: ' + (age == null ? '記録なし' : (Math.round(age / 100) / 10) + '秒'
        + (age < 4000 ? '  ← 4秒たつまで追従を休む設定に該当' : '')));
    } catch (e) { P('  _kara が読めません: ' + e.message); }
  }

  function watch () {
    L = [];
    P('=== 5秒間の記録 ===');
    P('読み上げを開始してから押してください。');
    var pa = document.getElementById('pageArea');
    var de = document.scrollingElement || document.documentElement;
    var t0 = Date.now(), n = 0;
    var paStart = pa ? pa.scrollTop : 0, deStart = de ? de.scrollTop : 0;
    var wantSeen = 0, blockedByUser = 0;
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      n++;
      try {
        var k = window._kara || {};
        if (k.want != null) wantSeen++;
        if (k.userAt && Date.now() - k.userAt < 4000) blockedByUser++;
      } catch (e) {}
      if (Date.now() - t0 >= 5000) {
        clearInterval(timer); timer = null;
        var paMove = pa ? (pa.scrollTop - paStart) : 0;
        var deMove = de ? (de.scrollTop - deStart) : 0;
        P('');
        P('  #pageArea が動いた量 : ' + Math.round(paMove) + 'px');
        P('  ページ全体が動いた量 : ' + Math.round(deMove) + 'px');
        P('  目標が立っていた割合 : ' + Math.round(wantSeen / n * 100) + '%');
        P('  手動操作待ちだった割合: ' + Math.round(blockedByUser / n * 100) + '%');
        P('');
        if (paMove === 0 && deMove === 0 && wantSeen === 0) P('→ 目標が立っていません。要素を掴めていない可能性。');
        else if (paMove === 0 && deMove === 0 && blockedByUser > n * 0.5) P('→ 「手動操作の直後」と判定され続けています。これが原因。');
        else if (paMove === 0 && deMove !== 0) P('→ ページ全体が動いています。追従は #pageArea を動かしているので噛み合っていません。');
        else if (paMove === 0 && wantSeen > 0) P('→ 目標はあるのに #pageArea が動きません。そこがスクロールしない要素の可能性。');
        else P('→ 動いています。');
      }
    }, 100);
  }

  window.__SDIAG = { show: function () { if (box) box.style.display = 'flex'; }, once: once, watch: watch };
  ui();
  P('「いま調べる」を押してください。');
  P('読み上げ中なら「5秒間 記録」も押してください。');
})();
