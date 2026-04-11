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
    authorProfile: 'aninovel_author_profile'
  };

  // === ユーティリティ ===
  function getLS(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch(e) { return null; }
  }
  function setLS(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
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

    /** ユーザー登録 */
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
      // 作者の場合は追加情報が必要
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
        // 作者個人情報を別キーに保存（Phase 2: 暗号化DB）
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
        role: data.role || 'reader',
        loggedIn: true,
        createdAt: new Date().toISOString()
      };
      setLS(KEYS.user, user);
      return Promise.resolve(user);
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
    }
  };
})();
