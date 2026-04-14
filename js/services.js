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
    readerProfiles: 'aninovel_reader_profiles'
  };

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

  // === カタログキャッシュ ===
  var _catalogCache = null;

  window.AninovelServices = {

    // ========== カタログ ==========

    /** 作品カタログを取得 */
    getCatalog: function() {
      if (_catalogCache) return Promise.resolve(_catalogCache);
      return fetch('data/catalog.json').then(function(r) {
        if (!r.ok) throw new Error('カタログの読み込みに失敗しました');
        return r.json();
      }).then(function(data) {
        _catalogCache = data;
        return data;
      });
    },

    /** 作品本体を取得 */
    getWork: function(workId) {
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
    getCurrentUser: function() {
      return Promise.resolve(getLS(KEYS.user) || null);
    },

    /** ログイン（Phase 1: メールに@があれば成功） */
    login: function(email, password) {
      if (!email || email.indexOf('@') === -1) {
        return Promise.reject(new Error('有効なメールアドレスを入力してください'));
      }
      if (!password || password.length < 4) {
        return Promise.reject(new Error('パスワードは4文字以上必要です'));
      }
      // Phase 1: 既存ユーザーをlocalStorageで探す
      var existing = getLS(KEYS.user);
      if (existing && existing.email === email) {
        existing.loggedIn = true;
        setLS(KEYS.user, existing);
        return Promise.resolve(existing);
      }
      // 新規ユーザーとして扱う
      var user = {
        id: 'user_' + Date.now(),
        email: email,
        displayName: email.split('@')[0],
        role: 'reader',
        loggedIn: true,
        createdAt: new Date().toISOString()
      };
      setLS(KEYS.user, user);
      return Promise.resolve(user);
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

      if (data.role === 'author') {
        setLS(KEYS.authorProfile, {
          realName: data.realName,
          address: data.address,
          phone: data.phone
        });
      }

      var user = {
        id: 'user_' + Date.now(),
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        loggedIn: true,
        verified: true,
        createdAt: data.createdAt
      };
      setLS(KEYS.user, user);
      delete pending[token];
      setLS(KEYS.pendingUsers, pending);

      return Promise.resolve(user);
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
      if (user) {
        user.loggedIn = false;
        setLS(KEYS.user, user);
      }
      return Promise.resolve();
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

    // ========== マイ作品（作者用ローカル作品） ==========

    /** 現在の作者のマイ作品一覧を取得 */
    getMyWorks: function() {
      var user = getLS(KEYS.user);
      if (!user || !user.loggedIn || user.role !== 'author') return Promise.resolve([]);
      var all = getLS(KEYS.myWorks) || {};
      var mine = all[user.id] || [];
      return Promise.resolve(mine);
    },

    /** マイ作品を新規作成 */
    createMyWork: function(meta) {
      var user = getLS(KEYS.user);
      if (!user || !user.loggedIn || user.role !== 'author') return Promise.reject(new Error('作者ログインが必要です'));
      var all = getLS(KEYS.myWorks) || {};
      var list = all[user.id] || [];
      var id = 'my_' + Date.now();
      var work = {
        id: id,
        title: meta.title || '無題の作品',
        description: meta.description || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: {
          version: '2.2',
          novel: { title: meta.title || '無題の作品', author: user.displayName },
          chapters: [],
          characters: [
            { id: 'narrator', name: 'ナレーター', shortName: 'ナ', gender: 'neutral', description: '物語の進行役', bubbleColor: '#F3F4F6', iconColor: '#6B7280', iconImage: null }
          ],
          content: [],
          displaySettings: { fontSize: 18, lineHeight: 2.0, iconSize: 56, font: "'Shippori Mincho', serif", orientation: 'horizontal', narratorStyle: 'bubble' }
        }
      };
      list.push(work);
      all[user.id] = list;
      setLS(KEYS.myWorks, all);
      return Promise.resolve(work);
    },

    /** マイ作品を削除 */
    deleteMyWork: function(workId) {
      var user = getLS(KEYS.user);
      if (!user) return Promise.reject(new Error('ログインが必要です'));
      var all = getLS(KEYS.myWorks) || {};
      var list = all[user.id] || [];
      all[user.id] = list.filter(function(w) { return w.id !== workId; });
      setLS(KEYS.myWorks, all);
      return Promise.resolve({ success: true });
    }
  };
})();
