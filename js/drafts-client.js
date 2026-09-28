/* ============================================================
 * AniNovel 下書きクライアント  js/drafts-client.js
 * ------------------------------------------------------------
 * 作品の置き場所を、端末の localStorage からサーバー(KV)へ移すための層。
 *
 * 考え方
 *   ・サーバーが正本。localStorage は「すぐ書ける控え」に格下げする。
 *   ・保存はボタンを押したときだけサーバーへ送る。自動保存はしない。
 *     KV の無料枠は1日1,000書き込みで、1回の保存で2件使うため。
 *   ・通信に失敗しても控えは残るので、書いたものは消えない。
 *     次に保存が成功したときにサーバーへ届く。
 *   ・下書きは公開されない。カタログに載るのはオーナーが承認したときだけ。
 *
 * 作品IDの世代
 *   my_<時刻>    … 旧。端末の中だけにあった作品
 *   draft_<...>  … 新。サーバーにある下書き
 *   pub_<...>    … 公開済みの作品（読者が読むもの）
 *   旧IDの作品は、作者が次にログインしたときに一度だけサーバーへ引っ越す。
 *
 * 公開までの流れ
 *   draft → (作者が依頼) → review → (オーナーが承認) → published
 *                                 → (差し戻し)       → rejected
 * ============================================================ */
(function (global) {
  'use strict';

  var API = '/api/drafts';
  var CACHE_KEY = 'aninovel_draft_cache';     // 一覧の控え
  var BODY_KEY = 'aninovel_draft_bodies';     // 本文の控え（保存待ちを含む）
  var LEGACY_KEY = 'aninovel_my_works';       // 旧: 端末の中だけにあった作品
  var MIGRATED_KEY = 'aninovel_drafts_migrated';

  /* ---------- 小道具 ---------- */

  function getLS(k, fallback) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function setLS(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { console.warn('[drafts] 端末への控えに失敗:', e && e.message); return false; }
  }

  function me() {
    try {
      var u = JSON.parse(localStorage.getItem('aninovel_user'));
      return (u && u.loggedIn && u._server) ? u : null;   // サーバーで確認できた人だけ
    } catch (e) { return null; }
  }

  /** 通信の失敗を、画面に出せる日本語にして投げる。 */
  function fail(res, body) {
    var msg = (body && body.message) || '';
    if (!msg) {
      if (res.status === 401) msg = 'ログインの有効期限が切れています。もう一度ログインしてください。';
      else if (res.status === 403) msg = 'この操作をする権限がありません。';
      else if (res.status === 404) msg = '作品が見つかりません。';
      else if (res.status === 413) msg = '作品が大きすぎます。';
      else msg = '通信に失敗しました (HTTP ' + res.status + ')';
    }
    var e = new Error(msg);
    e.status = res.status;
    e.code = (body && body.error) || null;
    return e;
  }

  async function call(path, opts) {
    var o = opts || {};
    var res = await fetch(API + (path || ''), {
      method: o.method || 'GET',
      headers: o.body ? { 'Content-Type': 'application/json' } : undefined,
      body: o.body ? JSON.stringify(o.body) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    var body = null;
    try { body = await res.json(); } catch (e) {}
    if (!res.ok) throw fail(res, body);
    return body || {};
  }

  /* ---------- 控え ---------- */

  function cachedList() { return getLS(CACHE_KEY, []) || []; }
  function cacheList(list) { setLS(CACHE_KEY, list || []); }

  function bodies() { return getLS(BODY_KEY, {}) || {}; }
  function cacheBody(id, draft, pending) {
    var all = bodies();
    all[id] = { draft: draft, at: Date.now(), pending: !!pending };
    setLS(BODY_KEY, all);
  }
  function cachedBody(id) { var b = bodies()[id]; return b ? b.draft : null; }
  function markSaved(id) {
    var all = bodies();
    if (all[id]) { all[id].pending = false; setLS(BODY_KEY, all); }
  }
  /** まだサーバーへ送れていない作品のID。 */
  function pendingIds() {
    var all = bodies();
    return Object.keys(all).filter(function (k) { return all[k] && all[k].pending; });
  }

  /* ---------- 旧作品の引っ越し ---------- */

  /**
   * localStorage の my_ 作品を、一度だけサーバーへ上げる。
   * 引っ越したあとも元のデータは消さない。うまくいかなかったときの保険。
   */
  async function migrateLegacy() {
    var u = me();
    if (!u) return { moved: 0, skipped: 0 };
    if (getLS(MIGRATED_KEY, null)) return { moved: 0, skipped: 0, already: true };

    var all = getLS(LEGACY_KEY, {}) || {};
    var mine = all[u.id] || [];
    if (!mine.length) { setLS(MIGRATED_KEY, { at: Date.now(), moved: 0 }); return { moved: 0, skipped: 0 }; }

    var moved = 0, skipped = 0, errors = [];
    for (var i = 0; i < mine.length; i++) {
      var w = mine[i];
      try {
        var created = await call('', {
          method: 'POST',
          body: { title: w.title || '無題の作品', description: w.description || '' },
        });
        if (w.data && Array.isArray(w.data.content)) {
          await call('/' + encodeURIComponent(created.id), {
            method: 'PUT',
            body: { data: w.data, title: w.title, description: w.description },
          });
        }
        moved++;
      } catch (e) {
        skipped++;
        errors.push((w.title || w.id) + ': ' + e.message);
      }
    }
    if (!skipped) setLS(MIGRATED_KEY, { at: Date.now(), moved: moved });
    if (errors.length) console.warn('[drafts] 引っ越せなかった作品:', errors);
    return { moved: moved, skipped: skipped, errors: errors };
  }

  /* ---------- 外に出す操作 ---------- */

  var Drafts = {

    /** サーバーにいる作者かどうか。未ログインなら false。 */
    available: function () { return !!me(); },

    /** 自分の下書き一覧。通信できなければ控えを返す。 */
    list: async function () {
      if (!me()) return [];
      try {
        var r = await call('');
        var list = r.drafts || [];
        cacheList(list);
        return list;
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        console.warn('[drafts] 一覧を取れなかったので控えを使います:', e.message);
        return cachedList();
      }
    },

    /**
     * 下書きを1件、本文つきで取り出す。
     *
     * 入口が2つある理由:
     *   Cloudflare Access は "api/admin/*" にしか付かない。
     *   作者はサイトのログイン(クッキー)で /api/drafts/:id を通る。
     *   オーナーが審査画面から開いたときはサイトのログインが無いことがあるので、
     *   断られたら Access が守っている /api/admin/drafts/:id を試す。
     *   どちらも通らなければ、本当に権限が無い。
     */
    get: async function (id) {
      try {
        var r = await call('/' + encodeURIComponent(id));
        cacheBody(id, r.draft, false);
        return r.draft;
      } catch (e) {
        if (e.status === 401 || e.status === 403) {
          try {
            var res = await fetch('/api/admin/drafts/' + encodeURIComponent(id),
              { cache: 'no-store', credentials: 'same-origin' });
            if (res.ok) {
              var j = await res.json();
              if (j && j.draft) {
                console.info('[drafts] オーナーとして審査のために開きました');
                return j.draft;
              }
            }
          } catch (e2) { /* Access のログイン画面へ飛ばされた等。元の失敗を返す */ }
        }
        var c = cachedBody(id);
        if (c && e.status !== 401 && e.status !== 403) {
          console.warn('[drafts] サーバーから取れなかったので控えを開きます:', e.message);
          return c;
        }
        throw e;
      }
    },

    /** 新規作成。サーバーに作ってから ID を返す。 */
    create: async function (meta) {
      var r = await call('', {
        method: 'POST',
        body: {
          title: (meta && meta.title) || '新しい作品',
          description: (meta && meta.description) || '',
          penName: (meta && meta.penName) || '',
        },
      });
      try { await Drafts.list(); } catch (e) {}
      return r.id;
    },

    /**
     * 保存。まず端末に控えを取り、それからサーバーへ送る。
     * 送信に失敗しても書いたものは残り、pending の印がつく。
     */
    save: async function (id, data, meta) {
      var m = meta || {};
      var local = cachedBody(id) || {};
      var merged = Object.assign({}, local, {
        id: id, data: data,
        title: m.title || local.title, description: m.description || local.description,
      });
      cacheBody(id, merged, true);           // 先に控える。ここは必ず成功させたい

      var r = await call('/' + encodeURIComponent(id), {
        method: 'PUT',
        body: { data: data, title: m.title, description: m.description, penName: m.penName },
      });
      markSaved(id);
      try { await Drafts.list(); } catch (e) {}
      return r;
    },

    /** 削除。公開中なら公開も止まる。 */
    remove: async function (id) {
      var r = await call('/' + encodeURIComponent(id), { method: 'DELETE' });
      var all = bodies(); delete all[id]; setLS(BODY_KEY, all);
      try { await Drafts.list(); } catch (e) {}
      return r;
    },

    /** 公開を依頼する。ここではまだ公開されない。 */
    submit: async function (id) {
      var r = await call('/' + encodeURIComponent(id) + '/submit', { method: 'POST' });
      try { await Drafts.list(); } catch (e) {}
      return r;
    },

    /** 取り下げる。審査待ちなら依頼を撤回、公開中なら公開を止める。 */
    withdraw: async function (id) {
      var r = await call('/' + encodeURIComponent(id) + '/submit', { method: 'DELETE' });
      try { await Drafts.list(); } catch (e) {}
      return r;
    },

    /* --- オーナー用 --- */

    /** 審査待ちの一覧。 */
    reviewQueue: async function () {
      var r = await call('?queue=1');
      return r.queue || [];
    },

    /** 承認して公開する。 */
    approve: async function (id, note) {
      return call('/' + encodeURIComponent(id) + '/review', {
        method: 'POST', body: { approve: true, note: note || '' },
      });
    },

    /** 差し戻す。理由は必須。 */
    reject: async function (id, note) {
      if (!note) throw new Error('差し戻すときは理由を書いてください。');
      return call('/' + encodeURIComponent(id) + '/review', {
        method: 'POST', body: { approve: false, note: note },
      });
    },

    /* --- 補助 --- */

    statusLabel: function (s) {
      return ({
        draft: '下書き',
        review: '審査待ち',
        published: '公開中',
        rejected: '差し戻し',
      })[s] || '下書き';
    },
    statusColor: function (s) {
      return ({
        draft: '#6B635A',
        review: '#F59E0B',
        published: '#059669',
        rejected: '#DC2626',
      })[s] || '#6B635A';
    },

    isDraftId: function (id) { return String(id || '').indexOf('draft_') === 0; },

    cachedList: cachedList,
    cachedBody: cachedBody,
    pendingIds: pendingIds,
    migrateLegacy: migrateLegacy,
  };

  global.AninovelDrafts = Drafts;

  // 作者としてログインしている端末に旧作品が残っていれば、静かに引っ越す。
  // 失敗しても画面は止めない。次回また試みる。
  if (me()) {
    setTimeout(function () {
      migrateLegacy().then(function (r) {
        if (r && r.moved) console.info('[drafts] 端末に残っていた作品を' + r.moved + '件サーバーへ移しました');
        if (r && r.skipped) console.warn('[drafts] ' + r.skipped + '件は移せませんでした。次回また試みます');
      }).catch(function (e) { console.warn('[drafts] 引っ越しに失敗:', e && e.message); });
    }, 1500);
  }

  console.info('[drafts] 下書きクライアント読込完了');
})(window);
