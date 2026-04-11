/**
 * アニノベル ポータル UI
 * services.js の AninovelServices を使用
 */
(function() {
  'use strict';
  var S = window.AninovelServices;
  var state = { user: null, rankSort: 'votes' };

  // === DOM ヘルパー ===
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k) {
      if (k === 'className') el.className = attrs[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (k === 'html') el.innerHTML = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    if (typeof children === 'string') el.textContent = children;
    else if (Array.isArray(children)) children.forEach(function(c) { if (c) el.appendChild(c); });
    return el;
  }

  // === テーマ ===
  function initTheme() {
    var saved = localStorage.getItem('aninovel_theme');
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  }
  function toggleTheme() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('aninovel_theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('aninovel_theme', 'dark');
    }
  }

  // === トースト ===
  function toast(msg) {
    var old = $('.toast');
    if (old) old.remove();
    var el = h('div', { className: 'toast' }, msg);
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 2500);
  }

  // === 作品カードを生成 ===
  function createWorkCard(work, votes) {
    var v = votes[work.id] || { total: 0, userVoted: false };
    var card = h('div', { className: 'work-card anim-slide' });
    card.onclick = function() { openWork(work.id); };

    var banner = h('div', { className: 'card-banner' });
    banner.style.background = work.coverColor;
    card.appendChild(banner);

    var body = h('div', { className: 'card-body' });
    body.appendChild(h('div', { className: 'card-title' }, work.title));
    body.appendChild(h('div', { className: 'card-author' }, work.author));
    body.appendChild(h('div', { className: 'card-description' }, work.description));

    var stats = h('div', { className: 'card-stats' });
    stats.appendChild(h('span', { className: 'stats-badge', html: '&#x1F4D6; ' + work.pageCount + '頁' }));
    stats.appendChild(h('span', { className: 'stats-badge', html: '&#x1F4DD; ' + work.charCount + '字' }));
    stats.appendChild(h('span', { className: 'stats-badge', html: '&#x1F464; ' + work.characterCount + '人' }));
    body.appendChild(stats);

    var tags = h('div', { className: 'card-tags' });
    work.tags.forEach(function(t) { tags.appendChild(h('span', { className: 'tag' }, t)); });
    body.appendChild(tags);

    var footer = h('div', { className: 'card-footer' });
    var date = h('span', { style: 'font-size:12px;color:var(--text-muted)' }, formatDate(work.createdAt));
    var voteBtn = createVoteBtn(work.id, v);
    footer.appendChild(date);
    footer.appendChild(voteBtn);
    body.appendChild(footer);

    card.appendChild(body);
    return card;
  }

  // === 投票ボタン ===
  function createVoteBtn(workId, v) {
    var btn = h('button', {
      className: 'vote-btn' + (v.userVoted ? ' voted' : ''),
      html: '&#x2764; <span class="vote-count">' + v.total + '</span>'
    });
    btn.onclick = function(e) {
      e.stopPropagation();
      S.castVote(workId).then(function(res) {
        btn.className = 'vote-btn' + (res.voted ? ' voted' : '');
        btn.querySelector('.vote-count').textContent = res.totalVotes;
        toast(res.voted ? '投票しました' : '投票を取り消しました');
      }).catch(function(err) {
        toast(err.message);
        showAuthModal();
      });
    };
    return btn;
  }

  // === ランキング項目 ===
  function createRankingItem(work, index, votes) {
    var v = votes[work.id] || { total: 0, userVoted: false };
    var item = h('div', { className: 'ranking-item' });
    item.onclick = function() { openWork(work.id); };

    var num = h('div', { className: 'ranking-number' }, String(index + 1));
    var info = h('div', { className: 'ranking-info' });
    info.appendChild(h('div', { className: 'ranking-title' }, work.title));
    info.appendChild(h('div', { className: 'ranking-author' }, work.author));

    var stats = h('div', { className: 'ranking-stats' });
    stats.appendChild(h('span', { className: 'stats-badge', html: '&#x2764; ' + (work.totalVotes || v.total) }));
    stats.appendChild(h('span', { className: 'stats-badge', html: '&#x1F4D6; ' + work.pageCount + '頁' }));

    var voteBtn = createVoteBtn(work.id, { total: work.totalVotes || v.total, userVoted: work.userVoted || v.userVoted });

    item.appendChild(num);
    item.appendChild(info);
    item.appendChild(stats);
    item.appendChild(voteBtn);
    return item;
  }

  // === ランキングセクション描画 ===
  function renderRanking(sortBy) {
    state.rankSort = sortBy || 'votes';
    S.getRanking(state.rankSort).then(function(works) {
      var list = $('#ranking-list');
      if (!list) return;
      list.innerHTML = '';
      works.forEach(function(w, i) {
        list.appendChild(createRankingItem(w, i, {}));
      });
      // ソートボタン更新
      $$('.ranking-sort-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.sort === state.rankSort);
      });
    });
  }

  // === ヒーロー統計 ===
  function renderHeroStats(catalog) {
    var totalWorks = catalog.works.length;
    var totalAuthors = [];
    var totalChars = 0;
    catalog.works.forEach(function(w) {
      if (totalAuthors.indexOf(w.author) === -1) totalAuthors.push(w.author);
      totalChars += w.charCount;
    });
    var el = $('#hero-stats');
    if (el) {
      el.innerHTML = '';
      [
        { num: totalWorks, label: '作品数' },
        { num: totalAuthors.length, label: '作者数' },
        { num: totalChars.toLocaleString(), label: '総文字数' }
      ].forEach(function(s) {
        var stat = h('div', { className: 'hero-stat' });
        stat.appendChild(h('span', { className: 'num' }, String(s.num)));
        stat.appendChild(h('span', { className: 'label' }, s.label));
        el.appendChild(stat);
      });
    }
  }

  // === 作品を開く ===
  function openWork(workId) {
    window.location.href = 'viewer.html?work=' + encodeURIComponent(workId);
  }

  // === 日付フォーマット ===
  function formatDate(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  // === 認証モーダル ===
  function showAuthModal() {
    var existing = $('#auth-modal');
    if (existing) existing.remove();

    var overlay = h('div', { className: 'modal-overlay', id: 'auth-modal' });
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var content = h('div', { className: 'modal-content anim-slide' });

    var title = h('div', { className: 'modal-title' });
    title.appendChild(h('span', {}, 'アカウント'));
    var closeBtn = h('button', { className: 'btn-icon', html: '&times;', style: 'font-size:24px;color:var(--text-primary)' });
    closeBtn.onclick = function() { overlay.remove(); };
    title.appendChild(closeBtn);
    content.appendChild(title);

    // タブ
    var tabGroup = h('div', { className: 'tab-group' });
    var loginTab = h('button', { className: 'tab-btn active', 'data-tab': 'login' }, 'ログイン');
    var registerTab = h('button', { className: 'tab-btn', 'data-tab': 'register' }, '新規登録');
    tabGroup.appendChild(loginTab);
    tabGroup.appendChild(registerTab);
    content.appendChild(tabGroup);

    // ログインフォーム
    var loginForm = h('div', { className: 'auth-form', id: 'login-form' });
    loginForm.appendChild(createFormGroup('メールアドレス', 'email', 'login-email', 'email'));
    loginForm.appendChild(createFormGroup('パスワード', 'password', 'login-password', 'password'));
    var loginBtn = h('button', { className: 'btn btn-author', style: 'width:100%;justify-content:center' }, 'ログイン');
    loginBtn.onclick = function() {
      var email = $('#login-email').value;
      var pw = $('#login-password').value;
      S.login(email, pw).then(function(user) {
        state.user = user;
        updateAuthUI();
        overlay.remove();
        toast('ログインしました');
      }).catch(function(err) { toast(err.message); });
    };
    loginForm.appendChild(loginBtn);
    content.appendChild(loginForm);

    // 登録フォーム
    var regForm = h('div', { className: 'auth-form', id: 'register-form', style: 'display:none' });
    regForm.appendChild(createFormGroup('表示名', 'text', 'reg-name', 'text'));
    regForm.appendChild(createFormGroup('メールアドレス', 'email', 'reg-email', 'email'));
    regForm.appendChild(createFormGroup('パスワード（6文字以上）', 'password', 'reg-password', 'password'));

    var warning = h('div', { className: 'warning-banner' }, '※Phase 1: データはブラウザのlocalStorageに保存されます。本番環境ではサーバー側で管理されます。');
    regForm.appendChild(warning);

    var regBtn = h('button', { className: 'btn btn-author', style: 'width:100%;justify-content:center' }, '登録');
    regBtn.onclick = function() {
      S.register({
        displayName: $('#reg-name').value,
        email: $('#reg-email').value,
        password: $('#reg-password').value,
        role: 'reader'
      }).then(function(user) {
        state.user = user;
        updateAuthUI();
        overlay.remove();
        toast('登録が完了しました');
      }).catch(function(err) { toast(err.message); });
    };
    regForm.appendChild(regBtn);
    content.appendChild(regForm);

    // タブ切り替え
    [loginTab, registerTab].forEach(function(tab) {
      tab.onclick = function() {
        loginTab.classList.toggle('active', tab === loginTab);
        registerTab.classList.toggle('active', tab === registerTab);
        loginForm.style.display = tab === loginTab ? '' : 'none';
        regForm.style.display = tab === registerTab ? '' : 'none';
      };
    });

    overlay.appendChild(content);
    document.body.appendChild(overlay);
  }

  function createFormGroup(labelText, type, id, inputType) {
    var group = h('div', { className: 'form-group' });
    group.appendChild(h('label', { 'for': id }, labelText));
    group.appendChild(h('input', { type: inputType || type, id: id }));
    return group;
  }

  // === 認証UI更新 ===
  function updateAuthUI() {
    var container = $('#auth-area');
    if (!container) return;
    container.innerHTML = '';
    if (state.user && state.user.loggedIn) {
      var badge = h('div', { className: 'user-badge' });
      badge.appendChild(h('span', { className: 'name' }, state.user.displayName));
      var logoutBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'ログアウト');
      logoutBtn.onclick = function() {
        S.logout().then(function() {
          state.user = null;
          updateAuthUI();
          toast('ログアウトしました');
        });
      };
      badge.appendChild(logoutBtn);
      container.appendChild(badge);
    } else {
      var loginBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'ログイン');
      loginBtn.onclick = showAuthModal;
      container.appendChild(loginBtn);
    }
  }

  // === メイン初期化 ===
  function init() {
    initTheme();

    // テーマ切替ボタン
    var themeBtn = $('#theme-toggle');
    if (themeBtn) themeBtn.onclick = toggleTheme;

    // ユーザー状態を復元
    S.getCurrentUser().then(function(user) {
      if (user && user.loggedIn) state.user = user;
      updateAuthUI();
    });

    // カタログ読み込み＆描画
    Promise.all([S.getCatalog(), S.getVotes()]).then(function(results) {
      var catalog = results[0];
      var votes = results[1];

      renderHeroStats(catalog);

      // 作品一覧
      var grid = $('#works-grid');
      if (grid) {
        catalog.works.forEach(function(w) {
          grid.appendChild(createWorkCard(w, votes));
        });
      }

      // ランキング
      renderRanking('votes');
    });

    // ランキングソートボタン
    $$('.ranking-sort-btn').forEach(function(btn) {
      btn.onclick = function() { renderRanking(btn.dataset.sort); };
    });
  }

  // DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
