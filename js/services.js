/**
 * アニノベル データサービス抽象化レイヤー
 * Phase 1: localStorage + 静的JSON
 * Phase 2: Supabase に差し替え予定
 */
(function() {
  'use strict';

  // === localStorage キー ===
  var KEYS = {
    votes: 'aninovel_votes',
    user: 'aninovel_user',
    bookmarks: 'aninovel_bookmarks',
    authorProfile: 'aninovel_author_profile',
    pendingUsers: 'aninovel_pending_users',
    readerCustom: 'aninovel_reader_custom',
    pwResetTokens: 'aninovel_pw_reset_tokens',
    myWorks: 'aninovel_my_works',
    readerProfiles: 'aninovel_reader_profiles',
    usersDir: 'aninovel_users_dir',
    suspendedWorks: 'aninovel_suspended_works',
    publishedWorks: 'aninovel_published_works'
  };

  // === オーナー ===
  var OWNER_EMAIL = 'nob.kota2@gmail.com';

  // === ユーティリティ ===
  function getLS(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch(e) { return null; }
  }
  function setLS(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function genToken() {
    return 'tok_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
  }

  // === ユーザーディレクトリ・ロール管理 ===
  function _dir() { return getLS(KEYS.usersDir) || {}; }
  function _saveDir(d) { setLS(KEYS.usersDir, d); }
  function _isOwnerEmail(email) { return (email || '').toLowerCase() === OWNER_EMAIL.toLowerCase(); }
  function _migrateUser(u) {
    if (!u) return u;
    if (!Array.isArray(u.roles)) u.roles = u.role ? [u.role] : ['reader'];
    if (_isOwnerEmail(u.email) && u.roles.indexOf('owner') === -1) u.roles.unshift('owner');
    if (!u.activeRole || u.roles.indexOf(u.activeRole) === -1) {
      u.activeRole = u.roles.indexOf('owner') >= 0 ? 'owner' : u.roles[0];
    }
    u.role = u.activeRole; // 後方互換
    return u;
  }
  function _upsertDir(user) {
    var d = _dir();
    var key = user.email.toLowerCase();
    var prev = d[key] || {};
    d[key] = Object.assign({}, prev, {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      authorProfile: user.authorProfile || prev.authorProfile || null,
      suspended: prev.suspended || false,
      createdAt: prev.createdAt || user.createdAt || new Date().toISOString()
    });
    _saveDir(d);
  }

  // === カタログキャッシュ ===
  var _catalogCache = null;

  window.AninovelServices = {

    // ========== カタログ ==========

    /** 作品カタログを取得（静的JSON＋投稿済み作品をマージ） */
    getCatalog: function() {
      var staticP = fetch('data/catalog.json').then(function(r) {
        if (!r.ok) throw new Error('カタログの読み込みに失敗しました');
        return r.json();
      });
      // サーバー(KV)の投稿作品カタログ — 他ユーザー/他端末の投稿もここから取得
      // キャッシュ回避は必須。これが無いと公開直後にブラウザキャッシュの古いカタログが返り、
      // 作品情報を編集してもカードが更新されない（同ファイル440/726行と同じ扱いに揃える）。
      var serverP = fetch('/api/catalog?cb=' + Date.now(), { cache: 'no-store' }).then(function(r) {
        return r.ok ? r.json() : { works: [] };
      }).catch(function() { return { works: [] }; });
      return Promise.all([staticP, serverP]).then(function(res) {
        var data = res[0];
        var server = res[1] || { works: [] };
        var susp = getLS(KEYS.suspendedWorks) || {};
        function addEntry(entry) {
          if (!entry || !entry.id) return;
          if (susp[entry.id]) return; // 公開停止中はカタログに含めない
          var idx = -1;
          for (var _k = 0; _k < data.works.length; _k++) { if (data.works[_k].id === entry.id) { idx = _k; break; } }
          if (idx >= 0) {
            // 既存（静的カタログ等）があれば、サーバー/新しい版で上書きマージ（coverImage等の新フィールドを反映）
            data.works[idx] = Object.assign({}, data.works[idx], entry);
          } else {
            data.works.push(entry);
          }
        }
        // サーバー投稿作品をマージ
        (server.works || []).forEach(addEntry);
        // 2026-09-29: 端末に残っている aninovel_published_works をカタログへ
        // 混ぜるのをやめた。公開はオーナーの承認を通ったものだけになったので、
        // 端末の古い記録を混ぜると「承認されていない作品が自分の画面にだけ
        // 公開済みとして見える」ことになり、紛らわしい。
        // サーバーのカタログ(__catalog__)だけを正とする。
        return data;
      });
    },

    /** 投稿済み作品の本体データを取得 */
    getPublishedWork: function(workId) {
      var pub = getLS(KEYS.publishedWorks) || {};
      if (pub[workId]) return Promise.resolve(pub[workId].data);
      return Promise.reject(new Error('投稿済み作品が見つかりません'));
    },

    /** 作品本体を取得 */
    getWork: function(workId) {
      // 下書き(draft_)はサーバーの下書き置き場から。作者本人しか読めない。
      if (workId && workId.indexOf('draft_') === 0) {
        try {
          return this._drafts().get(workId).then(function(d) { return d && d.data; });
        } catch (e) { return Promise.reject(e); }
      }
      // 投稿済み作品をまずチェック（pub_ プレフィックス or localStorage にある場合）
      var pub = getLS(KEYS.publishedWorks) || {};
      // 投稿作品(pub_)はサーバー(KV)から取得 — 他のブラウザ/ユーザーでも閲覧可能
      if (workId && workId.indexOf('pub_') === 0) {
        return fetch('/api/works/' + encodeURIComponent(workId)).then(function(r) {
          if (r.ok) return r.json();
          if (pub[workId]) return pub[workId].data;
          throw new Error('投稿作品が見つかりません: ' + workId);
        }).catch(function(e) {
          if (pub[workId]) return pub[workId].data;
          throw e;
        });
      }
      if (pub[workId]) return Promise.resolve(pub[workId].data);
      return this.getCatalog().then(function(catalog) {
        var entry = catalog.works.find(function(w) { return w.id === workId; });
        if (!entry) throw new Error('作品が見つかりません: ' + workId);
        return fetch(entry.contentUrl);
      }).then(function(r) {
        if (!r.ok) throw new Error('作品データの読み込みに失敗しました');
        return r.json();
      });
    },

    // ========== 投票・ランキング ==========

    /** 全投票データを取得 */
    getVotes: function() {
      return Promise.resolve(getLS(KEYS.votes) || {});
    },

    /** 投票をトグル（投票済みなら取消、未投票なら追加） */
    castVote: function(workId) {
      var user = getLS(KEYS.user);
      if (!user || !user.loggedIn) {
        return Promise.reject(new Error('投票するにはログインが必要です'));
      }
      var votes = getLS(KEYS.votes) || {};
      if (!votes[workId]) {
        votes[workId] = { total: 0, userVoted: false };
      }
      if (votes[workId].userVoted) {
        votes[workId].total = Math.max(0, votes[workId].total - 1);
        votes[workId].userVoted = false;
      } else {
        votes[workId].total += 1;
        votes[workId].userVoted = true;
      }
      setLS(KEYS.votes, votes);
      return Promise.resolve({
        success: true,
        voted: votes[workId].userVoted,
        totalVotes: votes[workId].total
      });
    },

    /** ランキング取得（ソート済み作品リスト） */
    getRanking: function(sortBy) {
      var self = this;
      return Promise.all([self.getCatalog(), self.getVotes()]).then(function(results) {
        var catalog = results[0];
        var votes = results[1];

        var works = catalog.works.map(function(w) {
          var v = votes[w.id] || { total: 0, userVoted: false };
          return Object.assign({}, w, {
            totalVotes: v.total,
            userVoted: v.userVoted
          });
        });

        switch (sortBy) {
          case 'newest':
            works.sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
            break;
          case 'pages':
            works.sort(function(a, b) { return b.pageCount - a.pageCount; });
            break;
          case 'chars':
            works.sort(function(a, b) { return b.charCount - a.charCount; });
            break;
          case 'votes':
          default:
            works.sort(function(a, b) { return b.totalVotes - a.totalVotes || new Date(b.createdAt) - new Date(a.createdAt); });
            break;
        }

        return works;
      });
    },

    // ========== 認証（Phase 1: モック） ==========

    /** 現在のユーザーを取得 */
    /**
     * いまの利用者。サーバのログイン状態(/api/auth/me)を正とする。
     * サーバでログインしていれば、それを aninovel_user に写す(_server:true の印付き)。
     * Home も viewer も aninovel_user を見ているので、ここを揃えれば既存のコードが動く。
     * サーバでログアウトしたら写しだけを消す。写しでない古い試作の記録には触らない。
     */
    getCurrentUser: function() {
      var local = getLS(KEYS.user);
      function keepLocal() {
        if (local && !local._server) { _migrateUser(local); setLS(KEYS.user, local); return local; }
        return local || null;
      }
      return fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(me) {
          if (me && me.loggedIn) {
            var prev = (local && local._server && local.email === me.email) ? local : null;
            var u = {
              id: me.email, email: me.email, displayName: me.nickname,
              roles: (me.roles || ['reader']).slice(),
              activeRole: prev ? prev.activeRole : null,
              loggedIn: true, _server: true
            };
            _migrateUser(u);
            setLS(KEYS.user, u);
            return u;
          }
          // サーバでは未ログイン。写しが残っていれば消す。
          if (local && local._server) { try { localStorage.removeItem(KEYS.user); } catch (e) {} return null; }
          return keepLocal();
        })
        .catch(function() { return keepLocal(); });
    },

    /** ログイン（Phase 1: メール検証のみ） */
    login: function(email, password) {
      if (!email || email.indexOf('@') === -1) {
        return Promise.reject(new Error('有効なメールアドレスを入力してください'));
      }
      if (!password || password.length < 4) {
        return Promise.reject(new Error('パスワードは4文字以上必要です'));
      }
      var d = _dir();
      var key = email.toLowerCase();
      var rec = d[key];
      // オーナー初回ログイン: 自動的にディレクトリに作成
      if (!rec && _isOwnerEmail(email)) {
        rec = {
          id: 'user_' + Date.now(),
          email: email,
          displayName: 'オーナー',
          roles: ['owner', 'author', 'reader'],
          authorProfile: null,
          suspended: false,
          createdAt: new Date().toISOString()
        };
        d[key] = rec; _saveDir(d);
      }
      if (!rec) {
        // 未登録メールは読者として自動作成（既存挙動を踏襲）
        rec = {
          id: 'user_' + Date.now(),
          email: email,
          displayName: email.split('@')[0],
          roles: ['reader'],
          authorProfile: null,
          suspended: false,
          createdAt: new Date().toISOString()
        };
        d[key] = rec; _saveDir(d);
      }
      if (rec.suspended) return Promise.reject(new Error('このアカウントは停止中です'));
      var user = {
        id: rec.id, email: rec.email, displayName: rec.displayName,
        roles: rec.roles.slice(), loggedIn: true, verified: true,
        authorProfile: rec.authorProfile, createdAt: rec.createdAt
      };
      _migrateUser(user);
      setLS(KEYS.user, user);
      return Promise.resolve(user);
    },

    /** アクティブロールを切替 */
    switchActiveRole: function(role) {
      var u = getLS(KEYS.user);
      if (!u || !u.loggedIn) return Promise.reject(new Error('ログインが必要です'));
      _migrateUser(u);
      if (u.roles.indexOf(role) === -1) return Promise.reject(new Error('このロールは未登録です: ' + role));
      u.activeRole = role; u.role = role;
      setLS(KEYS.user, u);
      return Promise.resolve(u);
    },

    /** ユーザー仮登録（メール確認トークン発行） */
    register: function(data) {
      if (!data.email || data.email.indexOf('@') === -1) {
        return Promise.reject(new Error('有効なメールアドレスを入力してください'));
      }
      if (!data.password || data.password.length < 6) {
        return Promise.reject(new Error('パスワードは6文字以上必要です'));
      }
      if (!data.displayName || data.displayName.trim() === '') {
        return Promise.reject(new Error('表示名を入力してください'));
      }
      if (data.role === 'author') {
        if (!data.realName || data.realName.trim() === '') {
          return Promise.reject(new Error('氏名を入力してください'));
        }
        if (!data.address || data.address.trim() === '') {
          return Promise.reject(new Error('住所を入力してください'));
        }
        if (!data.phone || data.phone.trim() === '') {
          return Promise.reject(new Error('電話番号を入力してください'));
        }
      }

      // 同一メールで既に別ロール登録がある場合は、マージ用の情報を pending に付与
      var d = _dir();
      var existing = d[data.email.toLowerCase()];
      var token = genToken();
      var pending = getLS(KEYS.pendingUsers) || {};
      pending[token] = {
        email: data.email,
        password: data.password,
        displayName: data.displayName,
        role: data.role || 'reader',
        realName: data.realName || '',
        address: data.address || '',
        phone: data.phone || '',
        mergeToExisting: !!existing,
        createdAt: new Date().toISOString()
      };
      setLS(KEYS.pendingUsers, pending);

      // Phase 1: 実際のメール送信はできないので、トークンを返してUI側でシミュレート
      return Promise.resolve({
        success: true,
        status: 'pending',
        token: token,
        message: '仮登録完了。メールに記載の確認URLにアクセスしてください。'
      });
    },

    /** メール確認（トークンで本登録） */
    confirmRegistration: function(token) {
      var pending = getLS(KEYS.pendingUsers) || {};
      var data = pending[token];
      if (!data) {
        return Promise.reject(new Error('無効または期限切れの確認トークンです'));
      }

      var d = _dir();
      var key = data.email.toLowerCase();
      var rec = d[key];
      var authorProfile = null;
      if (data.role === 'author') {
        authorProfile = { realName: data.realName, address: data.address, phone: data.phone };
        setLS(KEYS.authorProfile, authorProfile);
      }
      if (rec) {
        // 既存ユーザーにロールを追加
        if (rec.roles.indexOf(data.role) === -1) rec.roles.push(data.role);
        if (authorProfile) rec.authorProfile = authorProfile;
        rec.displayName = data.displayName || rec.displayName;
      } else {
        rec = {
          id: 'user_' + Date.now(),
          email: data.email,
          displayName: data.displayName,
          roles: [data.role],
          authorProfile: authorProfile,
          suspended: false,
          createdAt: data.createdAt
        };
      }
      if (_isOwnerEmail(data.email) && rec.roles.indexOf('owner') === -1) rec.roles.unshift('owner');
      d[key] = rec; _saveDir(d);

      var user = {
        id: rec.id, email: rec.email, displayName: rec.displayName,
        roles: rec.roles.slice(), loggedIn: true, verified: true,
        authorProfile: rec.authorProfile, createdAt: rec.createdAt,
        activeRole: data.role
      };
      _migrateUser(user);
      user.activeRole = data.role; user.role = data.role;
      setLS(KEYS.user, user);
      delete pending[token];
      setLS(KEYS.pendingUsers, pending);

      return Promise.resolve(user);
    },

    // ========== オーナー管理機能 ==========

    _requireOwner: function() {
      var u = getLS(KEYS.user);
      if (!u || !u.loggedIn) throw new Error('ログインが必要です');
      _migrateUser(u);
      if (u.roles.indexOf('owner') === -1) throw new Error('オーナー権限が必要です');
      return u;
    },

    /** 全ユーザー一覧（オーナー限定） */
    adminListUsers: function(filter) {
      try { this._requireOwner(); } catch(e) { return Promise.reject(e); }
      var d = _dir();
      var list = Object.keys(d).map(function(k) { return d[k]; });
      if (filter === 'author') list = list.filter(function(u) { return u.roles.indexOf('author') >= 0; });
      else if (filter === 'reader') list = list.filter(function(u) { return u.roles.indexOf('reader') >= 0; });
      return Promise.resolve(list);
    },

    /** ユーザーをサスペンド／復活 */
    adminSetSuspended: function(email, suspended) {
      try { this._requireOwner(); } catch(e) { return Promise.reject(e); }
      if (_isOwnerEmail(email)) return Promise.reject(new Error('オーナーアカウントは停止できません'));
      var d = _dir();
      var key = (email || '').toLowerCase();
      if (!d[key]) return Promise.reject(new Error('ユーザーが見つかりません'));
      d[key].suspended = !!suspended;
      _saveDir(d);
      return Promise.resolve({ success: true });
    },

    /** 全作品一覧（オーナー限定：全作者のマイ作品） */
    adminListAllWorks: function() {
      try { this._requireOwner(); } catch(e) { return Promise.reject(e); }
      var all = getLS(KEYS.myWorks) || {};
      var dir = _dir();
      var susp = getLS(KEYS.suspendedWorks) || {};
      var result = [];
      var seen = {};
      // この端末のローカル下書き
      Object.keys(all).forEach(function(uid) {
        (all[uid] || []).forEach(function(w) {
          var owner = null;
          Object.keys(dir).forEach(function(k) { if (dir[k].id === uid) owner = dir[k]; });
          result.push({
            id: w.id, title: w.title, description: w.description,
            authorId: uid, authorEmail: owner ? owner.email : '(不明)',
            authorName: owner ? owner.displayName : '(不明)',
            createdAt: w.createdAt, updatedAt: w.updatedAt,
            suspended: !!susp[w.id], source: 'local'
          });
          seen[w.id] = true;
        });
      });
      // サーバーの公開作品（全ユーザー分）をマージ
      return fetch('/api/catalog?cb=' + Date.now(), { cache: 'no-store' })
        .then(function(r) { return r.json(); })
        .then(function(cat) {
          (cat && cat.works ? cat.works : []).forEach(function(w) {
            if (!w || !w.id || seen[w.id]) return;
            result.push({
              id: w.id, title: w.title || '(無題)', description: w.description || '',
              authorId: w.authorId || '', authorEmail: '',
              authorName: w.author || '(不明)',
              createdAt: w.createdAt, updatedAt: w.updatedAt,
              suspended: !!susp[w.id], source: 'server'
            });
          });
          return result;
        })
        .catch(function() { return result; });
    },

    /** 作品をサーバーから完全削除（オーナー専用・公開作品向け） */
    adminDeleteWork: function(workId) {
      try { this._requireOwner(); } catch(e) { return Promise.reject(e); }
      if (!workId) return Promise.reject(new Error('作品IDが指定されていません'));
      // ローカルの公開済み記録があれば除去
      var pub = getLS(KEYS.publishedWorks) || {};
      if (pub[workId]) { delete pub[workId]; setLS(KEYS.publishedWorks, pub); }
      // サーバー(KV)からも削除
      return fetch('/api/works/' + encodeURIComponent(workId), { method: 'DELETE' })
        .then(function(r) { return { success: true, serverSynced: !!(r && r.ok) }; })
        .catch(function() { return { success: true, serverSynced: false }; });
    },

    /** 作品を公開停止／再開 */
    adminSetWorkSuspended: function(workId, suspended) {
      try { this._requireOwner(); } catch(e) { return Promise.reject(e); }
      var susp = getLS(KEYS.suspendedWorks) || {};
      if (suspended) susp[workId] = true; else delete susp[workId];
      setLS(KEYS.suspendedWorks, susp);
      return Promise.resolve({ success: true });
    },

    /** 作品が停止中か（表示側から利用） */
    isWorkSuspended: function(workId) {
      var susp = getLS(KEYS.suspendedWorks) || {};
      return Promise.resolve(!!susp[workId]);
    },

    /** パスワード再設定リクエスト */
    requestPasswordReset: function(email) {
      if (!email || email.indexOf('@') === -1) {
        return Promise.reject(new Error('有効なメールアドレスを入力してください'));
      }
      var token = genToken();
      var tokens = getLS(KEYS.pwResetTokens) || {};
      tokens[token] = { email: email, createdAt: new Date().toISOString() };
      setLS(KEYS.pwResetTokens, tokens);

      return Promise.resolve({
        success: true,
        token: token,
        message: 'パスワード再設定用のメールを送信しました。'
      });
    },

    /** パスワード再設定実行 */
    resetPassword: function(token, newPassword) {
      if (!newPassword || newPassword.length < 6) {
        return Promise.reject(new Error('パスワードは6文字以上必要です'));
      }
      var tokens = getLS(KEYS.pwResetTokens) || {};
      var data = tokens[token];
      if (!data) {
        return Promise.reject(new Error('無効または期限切れのトークンです'));
      }
      // Phase 1: パスワードはlocalStorageには保存しない（モック）
      delete tokens[token];
      setLS(KEYS.pwResetTokens, tokens);
      return Promise.resolve({ success: true, message: 'パスワードを再設定しました。新しいパスワードでログインしてください。' });
    },

    /** ログアウト */
    logout: function() {
      var user = getLS(KEYS.user);
      // サーバのセッションも終える
      return fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
        .catch(function() {})
        .then(function() {
          if (user) {
            if (user._server) { try { localStorage.removeItem(KEYS.user); } catch (e) {} }
            else { user.loggedIn = false; setLS(KEYS.user, user); }
          }
        });
    },

    // ========== 読者カスタマイズ（プロファイル対応） ==========

    /** 現在のプロファイル構造を取得 */
    _getProfileRoot: function() {
      var user = getLS(KEYS.user);
      var all = getLS(KEYS.readerProfiles) || {};
      var key = (user && user.loggedIn) ? user.id : '_anon';
      if (!all[key]) all[key] = { current: 'デフォルト', profiles: { 'デフォルト': {} } };
      if (!all[key].profiles) all[key].profiles = { 'デフォルト': {} };
      if (!all[key].profiles[all[key].current]) all[key].profiles[all[key].current] = {};
      return { root: all, userKey: key, bundle: all[key] };
    },

    /** プロファイル一覧を取得 */
    getReaderProfiles: function() {
      var r = this._getProfileRoot();
      return Promise.resolve({
        current: r.bundle.current,
        profiles: Object.keys(r.bundle.profiles)
      });
    },

    /** 使用プロファイルを切替 */
    setCurrentReaderProfile: function(name) {
      var r = this._getProfileRoot();
      if (!r.bundle.profiles[name]) r.bundle.profiles[name] = {};
      r.bundle.current = name;
      r.root[r.userKey] = r.bundle;
      setLS(KEYS.readerProfiles, r.root);
      return Promise.resolve({ success: true, current: name });
    },

    /** プロファイルを新規作成 */
    createReaderProfile: function(name) {
      if (!name || !name.trim()) return Promise.reject(new Error('プロファイル名を入力してください'));
      var r = this._getProfileRoot();
      if (r.bundle.profiles[name]) return Promise.reject(new Error('同名のプロファイルが既に存在します'));
      r.bundle.profiles[name] = {};
      r.bundle.current = name;
      r.root[r.userKey] = r.bundle;
      setLS(KEYS.readerProfiles, r.root);
      return Promise.resolve({ success: true, current: name });
    },

    /** プロファイルを削除（デフォルトは削除不可） */
    deleteReaderProfile: function(name) {
      if (name === 'デフォルト') return Promise.reject(new Error('デフォルトプロファイルは削除できません'));
      var r = this._getProfileRoot();
      delete r.bundle.profiles[name];
      if (r.bundle.current === name) r.bundle.current = 'デフォルト';
      r.root[r.userKey] = r.bundle;
      setLS(KEYS.readerProfiles, r.root);
      return Promise.resolve({ success: true });
    },

    /** 現在のプロファイルから作品のカスタマイズデータを取得 */
    getReaderCustom: function(workId) {
      var r = this._getProfileRoot();
      var p = r.bundle.profiles[r.bundle.current] || {};
      return Promise.resolve(p[workId] || null);
    },

    /** 現在のプロファイルに作品のカスタマイズデータを保存 */
    saveReaderCustom: function(workId, customData) {
      var r = this._getProfileRoot();
      if (!r.bundle.profiles[r.bundle.current]) r.bundle.profiles[r.bundle.current] = {};
      r.bundle.profiles[r.bundle.current][workId] = customData;
      r.root[r.userKey] = r.bundle;
      setLS(KEYS.readerProfiles, r.root);
      return Promise.resolve({ success: true });
    },

    /** 現在のプロファイルから作品のカスタマイズを削除（作者推奨に戻す） */
    resetReaderCustom: function(workId) {
      var r = this._getProfileRoot();
      var p = r.bundle.profiles[r.bundle.current];
      if (p) delete p[workId];
      r.root[r.userKey] = r.bundle;
      setLS(KEYS.readerProfiles, r.root);
      return Promise.resolve({ success: true });
    },

    // ========== しおり ==========

    /** 作品のしおりを取得 */
    getBookmarks: function(workId) {
      var all = getLS(KEYS.bookmarks) || {};
      return Promise.resolve(all[workId] || []);
    },

    /** しおりを保存 */
    saveBookmark: function(workId, page, title) {
      var all = getLS(KEYS.bookmarks) || {};
      if (!all[workId]) all[workId] = [];
      all[workId].push({
        id: 'bm_' + Date.now(),
        page: page,
        title: title,
        timestamp: new Date().toISOString()
      });
      setLS(KEYS.bookmarks, all);
      return Promise.resolve({ success: true });
    },

    /** しおりを削除 */
    deleteBookmark: function(workId, bookmarkId) {
      var all = getLS(KEYS.bookmarks) || {};
      if (all[workId]) {
        all[workId] = all[workId].filter(function(b) { return b.id !== bookmarkId; });
        setLS(KEYS.bookmarks, all);
      }
      return Promise.resolve({ success: true });
    },

    // ========== 作者の作品（サーバー保存） ==========
    //
    // 2026-09-29 変更: 作品の置き場所を端末の localStorage から
    // サーバー(KV)へ移した。中身は js/drafts-client.js にある。
    // ここは呼び出し側（portal.js / viewer.html）の書き方を変えずに済むよう、
    // 従来と同じ名前・同じ Promise を返す薄い窓口として残している。
    //
    // 公開までの流れが変わった点に注意。
    //   以前: publishWork() を押した瞬間にカタログへ載っていた
    //   いま: publishWork() は「公開の依頼」。載るのはオーナーが承認したとき

    _drafts: function() {
      var D = window.AninovelDrafts;
      if (!D) throw new Error('下書き機能が読み込まれていません (js/drafts-client.js)');
      return D;
    },

    /** 自分の作品一覧。サーバーから取る。 */
    getMyWorks: function() {
      var user = getLS(KEYS.user);
      if (!user || !user.loggedIn || !(user.roles && user.roles.indexOf('author') >= 0)) {
        return Promise.resolve([]);
      }
      try {
        return this._drafts().list().then(function(list) {
          // 呼び出し側は w.title / w.updatedAt / w.id を見る。形はそのまま。
          return list.map(function(w) {
            return {
              id: w.id, title: w.title, description: w.description || '',
              createdAt: w.createdAt, updatedAt: w.updatedAt,
              status: w.status, publishedId: w.publishedId || null,
              reviewNote: w.reviewNote || '', submittedAt: w.submittedAt || null,
              itemCount: w.itemCount || 0,
            };
          });
        });
      } catch (e) { return Promise.reject(e); }
    },

    /** 作品を1件、本文つきで取り出す。 */
    getMyWork: function(workId) {
      try { return this._drafts().get(workId); }
      catch (e) { return Promise.reject(e); }
    },

    /** 新規作成。サーバーに作ってから、その作品を返す。 */
    createMyWork: function(meta) {
      var user = getLS(KEYS.user);
      if (!user || !user.loggedIn || !(user.roles && user.roles.indexOf('author') >= 0)) {
        return Promise.reject(new Error('作者としてログインしてください'));
      }
      var D;
      try { D = this._drafts(); } catch (e) { return Promise.reject(e); }
      return D.create({
        title: (meta && meta.title) || '新しい作品',
        description: (meta && meta.description) || '',
        penName: user.nickname || user.displayName || '',
      }).then(function(id) {
        return { id: id, title: (meta && meta.title) || '新しい作品', status: 'draft' };
      });
    },

    /** 保存。端末に控えてからサーバーへ送る。 */
    saveMyWork: function(workId, data, meta) {
      try { return this._drafts().save(workId, data, meta || {}); }
      catch (e) { return Promise.reject(e); }
    },

    /** 削除。公開中なら公開も止まる。 */
    deleteMyWork: function(workId) {
      try {
        return this._drafts().remove(workId).then(function() { return { success: true }; });
      } catch (e) { return Promise.reject(e); }
    },

    // ========== 公開の依頼と取り下げ ==========

    /**
     * 公開を依頼する。
     * 名前は以前のまま publishWork だが、**ここでは公開されない**。
     * オーナーが審査して承認したときに、はじめてカタログへ載る。
     */
    publishWork: function(workId) {
      try {
        return this._drafts().submit(workId).then(function(r) {
          return { success: true, status: r.status, submittedAt: r.submittedAt, review: true };
        });
      } catch (e) { return Promise.reject(e); }
    },

    /** 取り下げる。審査待ちなら依頼を撤回し、公開中なら公開を止める。 */
    unpublishWork: function(workId) {
      try {
        return this._drafts().withdraw(workId).then(function(r) {
          return { success: true, status: r.status, unpublished: r.unpublished || 0 };
        });
      } catch (e) { return Promise.reject(e); }
    },

    /** 公開中かどうか。一覧の控えから見る。 */
    isPublished: function(workId) {
      try {
        var list = this._drafts().cachedList();
        var w = list.filter(function(x) { return x && x.id === workId; })[0];
        return Promise.resolve(!!(w && w.status === 'published'));
      } catch (e) { return Promise.resolve(false); }
    },

    /** いまの状態（draft / review / published / rejected）。 */
    workStatus: function(workId) {
      try {
        var list = this._drafts().cachedList();
        var w = list.filter(function(x) { return x && x.id === workId; })[0];
        return Promise.resolve(w ? (w.status || 'draft') : null);
      } catch (e) { return Promise.resolve(null); }
    }
  };
})();
