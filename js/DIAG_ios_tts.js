/* =========================================================================
   AniNovel  iPhone 再生経路の追跡  DIAG_ios_tts.js
   ------------------------------------------------------------------------
   iPhone ではコンソールが見られないので、画面の上に結果を重ねて表示する。

   使い方:
     1. iPhone の Chrome で AniNovel の作品を開く
     2. アドレスバーに次を貼って実行する
        (ブックマークレットとして登録するか、
         PC で作った短縮URLから読み込む形でもよい)

     もっと簡単な方法:
        viewer.html に一時的に <script src="js/DIAG_ios_tts.js"></script> を足し、
        画面右下に出る「診断」ボタンを押す。確認後に外す。

   何を見るか:
     ・その台詞に事前生成音声があるか (_hasPreAudio)
     ・音声ソース表がどう作られているか (_audioSourcesJa)
     ・R2 のマニフェストが取れているか
     ・実際にどの再生関数へ入ったか
     ・audio 要素のエラーと状態
   ========================================================================= */
(function () {
  'use strict';
  if (window.__IOSDIAG) { window.__IOSDIAG.show(); return; }

  var L = [];
  var box, pre;

  function ui () {
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:52%;z-index:2147483647;'
      + 'background:#fff;border-top:3px solid #4f46e5;display:flex;flex-direction:column;'
      + 'font-family:-apple-system,sans-serif;font-size:12px';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;padding:6px;background:#eef2ff';
    var mk = function (t, fn) {
      var b = document.createElement('button');
      b.textContent = t;
      b.style.cssText = 'flex:1;padding:8px;font-size:12px;border:0;border-radius:6px;background:#4f46e5;color:#fff';
      b.onclick = fn; bar.appendChild(b); return b;
    };
    mk('状態を調べる', probe);
    mk('1文だけ再生', tryOne);
    mk('消す', function () { box.style.display = 'none'; });
    pre = document.createElement('div');
    pre.style.cssText = 'flex:1;overflow:auto;padding:8px;white-space:pre-wrap;word-break:break-all;background:#fff';
    box.appendChild(bar); box.appendChild(pre);
    document.body.appendChild(box);
  }
  function P (s) { L.push(String(s)); pre.textContent = L.join('\n'); pre.scrollTop = pre.scrollHeight; }

  function probe () {
    L = [];
    P('=== 状態 ===');
    P('VER: ' + (window.__ANINOVEL_VER__ || '?'));
    P('UA: ' + navigator.userAgent.slice(0, 90));
    try { P('workId: ' + _currentWorkId()); } catch (e) { P('workId 取得失敗'); }
    P('表示言語: ' + (state && state.lang));

    var items = (state.content || []).filter(function (b) {
      return b && b.type !== 'pageBreak' && (b.text || '').trim();
    });
    P('ブロック: ' + items.length + ' 件');

    // 音声ソース表
    try {
      var m = window._audioSourcesJa || {};
      var ks = Object.keys(m);
      P('_audioSourcesJa: ' + ks.length + ' 件');
      if (ks.length) P('  例: ' + JSON.stringify(m[ks[0]]).slice(0, 120));
    } catch (e) { P('_audioSourcesJa 取得失敗: ' + e.message); }

    // 事前生成音声の判定
    try {
      var yes = 0, no = 0, firstNo = null;
      items.slice(0, 200).forEach(function (b) {
        if (_hasPreAudio(b.id)) yes++; else { no++; if (!firstNo) firstNo = b.id; }
      });
      P('_hasPreAudio: 先頭200件のうち あり ' + yes + ' / なし ' + no);
      if (firstNo) P('  最初に「なし」だったid: ' + firstNo);
    } catch (e) { P('_hasPreAudio 失敗: ' + e.message); }

    // Web Speech
    try {
      var v = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
      P('Web Speech の音声: ' + v.length + ' 件 / 日本語 '
        + v.filter(function (x) { return /ja/i.test(x.lang); }).length + ' 件');
    } catch (e) { P('Web Speech 失敗'); }

    // R2 マニフェスト
    var wid = _currentWorkId();
    fetch('/api/audio/' + wid, { cache: 'no-store' }).then(function (r) {
      P('マニフェスト HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var n = Object.keys((j && j.items) || {}).length;
      P('  サーバの音声: ' + n + ' 件');
      if (n && items.length) {
        var has = j.items[items[0].id] !== undefined;
        P('  先頭ブロックの音声: ' + (has ? 'あり' : 'なし ← ここが問題'));
      }
    }).catch(function (e) { P('マニフェスト取得に失敗: ' + e.message); });
  }

  // 先頭ブロックを1つだけ、AniNovel の関数で鳴らしてみる
  function tryOne () {
    L = [];
    P('=== 1文だけ再生 ===');
    var items = (state.content || []).filter(function (b) {
      return b && b.type !== 'pageBreak' && (b.text || '').trim();
    });
    if (!items.length) { P('ブロックがありません'); return; }
    var it = items[0];
    P('対象: ' + it.id + ' / ' + (it.text || '').slice(0, 30));
    P('_hasPreAudio: ' + (function () { try { return _hasPreAudio(it.id); } catch (e) { return 'エラー ' + e.message; } })());

    var t0 = Date.now();
    try {
      _speakItem(it, function () { P('onEnd が呼ばれました (' + (Date.now() - t0) + 'ms)'); });
      P('_speakItem を呼びました。音は出ましたか？');
      setTimeout(function () {
        P('--- 3秒後 ---');
        try {
          P('_preAudioCtrl: ' + (window._preAudioCtrl ? 'あり' : 'なし'));
          var a = document.querySelector('audio');
          if (a) {
            P('audio: readyState=' + a.readyState + ' paused=' + a.paused
              + ' currentTime=' + a.currentTime.toFixed(2)
              + ' error=' + (a.error ? a.error.code : 'なし'));
            P('  src: ' + String(a.src).slice(0, 80));
          } else P('audio 要素が見つかりません');
        } catch (e) { P('状態取得に失敗: ' + e.message); }
      }, 3000);
    } catch (e) { P('_speakItem が例外: ' + e.message); }
  }

  window.__IOSDIAG = { show: function () { if (box) box.style.display = 'flex'; }, probe: probe };
  ui();
  P('「状態を調べる」を押してください。');
})();
