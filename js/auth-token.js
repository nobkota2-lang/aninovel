/* ============================================================
 * AniNovel 書き込みトークン  js/auth-token.js
 * ------------------------------------------------------------
 * サーバーを変更する操作 (PUT / POST / DELETE を /api/ 宛に送るとき) に
 * Authorization ヘッダを自動で付ける。
 *
 * 各所の fetch を1つずつ書き換えると漏れが出るので、fetch 自体を包む。
 * これで viewer.html / server-save.js / portal.js すべてが一度に対応する。
 *
 * 使い方 (作者・オーナーの端末で一度だけ):
 *     __setWriteToken()          … 入力欄が出る。Cloudflare に設定した値を貼る
 *     __writeTokenStatus()       … 設定されているか確認
 *     __clearWriteToken()        … 端末から消す (共用PCを離れるとき)
 *
 * トークンはこの端末の localStorage にだけ入る。サーバーへは
 * Authorization ヘッダとしてのみ送られ、作品データには一切含まれない。
 * ============================================================ */
(function () {
  'use strict';

  var KEY = 'aninovel_write_token';
  var WRITE_METHODS = { PUT: 1, POST: 1, DELETE: 1, PATCH: 1 };

  function getToken() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  // 同一オリジンの /api/ 宛かどうか。localhost:50021 (VOICEVOX) などには付けない。
  function isOurApi(url) {
    try {
      var u = new URL(url, location.href);
      if (u.origin !== location.origin) return false;
      return u.pathname.indexOf('/api/') === 0;
    } catch (e) { return false; }
  }

  var origFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    try {
      var tok = getToken();
      if (tok) {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var method = String(
          (init && init.method) || (input && input.method) || 'GET'
        ).toUpperCase();

        if (WRITE_METHODS[method] && isOurApi(url)) {
          init = Object.assign({}, init);
          var h = new Headers((init && init.headers) || (input && input.headers) || undefined);
          if (!h.has('Authorization')) h.set('Authorization', 'Bearer ' + tok);
          init.headers = h;
        }
      }
    } catch (e) {
      // 何があっても素の fetch は壊さない
      console.warn('[auth-token] ヘッダ付与に失敗:', e && e.message);
    }
    return origFetch(input, init);
  };

  /* ---------- 操作用 ---------- */

  window.__setWriteToken = function (v) {
    if (typeof v !== 'string' || !v) {
      v = window.prompt('書き込みトークンを貼り付けてください\n(Cloudflare の ANINOVEL_WRITE_TOKEN と同じ値)');
      if (!v) { console.log('[auth-token] 取り消しました'); return false; }
    }
    v = v.trim();
    try {
      localStorage.setItem(KEY, v);
      console.log('[auth-token] 保存しました (' + v.length + '文字)。この端末でのみ有効です。');
      return true;
    } catch (e) {
      console.error('[auth-token] 保存に失敗:', e);
      return false;
    }
  };

  window.__clearWriteToken = function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    console.log('[auth-token] この端末から削除しました');
  };

  window.__writeTokenStatus = async function () {
    var tok = getToken();
    console.log('この端末のトークン :', tok ? ('あり (' + tok.length + '文字)') : 'なし');
    // 実際に書き込みが通るかを、無害な方法で確かめる
    try {
      var r = await fetch('/api/works/__auth_probe__', { method: 'DELETE' });
      var body = '';
      try { body = JSON.stringify(await r.json()); } catch (e) {}
      if (r.status === 401 || r.status === 403) {
        console.log('サーバーの認証   : 有効。この端末は書き込め' + (tok ? 'ません（トークンが違う可能性）' : 'ません（正常）'));
      } else {
        console.log('サーバーの認証   : ' + (tok ? '有効で、この端末は書き込めます' : '⚠ 無効（誰でも書き込める状態）'));
      }
      console.log('  応答 HTTP ' + r.status + ' ' + body.slice(0, 120));
    } catch (e) {
      console.warn('確認に失敗:', e && e.message);
    }
  };

  console.log('[auth-token] 読み込み完了' + (getToken() ? ' / トークンあり' : ''));
})();
