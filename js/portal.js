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
  function showAuthModal(initialTab) {
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
    var loginTab = h('button', { className: 'tab-btn' + (initialTab !== 'register' ? ' active' : ''), 'data-tab': 'login' }, 'ログイン');
    var registerTab = h('button', { className: 'tab-btn' + (initialTab === 'register' ? ' active' : ''), 'data-tab': 'register' }, '新規登録');
    tabGroup.appendChild(loginTab);
    tabGroup.appendChild(registerTab);
    content.appendChild(tabGroup);

    // === ログインフォーム ===
    var loginForm = h('div', { className: 'auth-form', id: 'login-form', style: initialTab === 'register' ? 'display:none' : '' });
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

    // パスワードを忘れた方
    var forgotLink = h('button', {
      style: 'background:none;border:none;color:var(--accent-author);font-size:13px;cursor:pointer;margin-top:4px;text-align:center;width:100%;font-family:inherit'
    }, 'パスワードを忘れた方はこちら');
    forgotLink.onclick = function() { showPasswordResetModal(overlay); };
    loginForm.appendChild(forgotLink);
    content.appendChild(loginForm);

    // === 登録フォーム ===
    var regForm = h('div', { className: 'auth-form', id: 'register-form', style: initialTab === 'register' ? '' : 'display:none' });

    // 読者/作者 選択
    var roleGroup = h('div', { className: 'form-group' });
    roleGroup.appendChild(h('label', {}, 'アカウント種別'));
    var roleSelect = h('select', { id: 'reg-role', style: 'padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;background:var(--panel-bg);color:var(--text-primary)' });
    roleSelect.appendChild(h('option', { value: 'reader' }, '読者（メールアドレスのみ）'));
    roleSelect.appendChild(h('option', { value: 'author' }, '作者（個人情報の登録が必要）'));
    roleGroup.appendChild(roleSelect);
    regForm.appendChild(roleGroup);

    regForm.appendChild(createFormGroup('表示名', 'text', 'reg-name', 'text'));
    regForm.appendChild(createFormGroup('メールアドレス', 'email', 'reg-email', 'email'));
    regForm.appendChild(createFormGroup('パスワード（6文字以上）', 'password', 'reg-password', 'password'));

    // 作者用追加フィールド（初期非表示）
    var authorFields = h('div', { id: 'author-fields', style: 'display:none' });
    var authorNotice = h('div', { className: 'warning-banner' }, '作者登録には個人情報が必要です。これらの情報は作品の権利管理のために使用されます。');
    authorFields.appendChild(authorNotice);
    authorFields.appendChild(createFormGroup('氏名（本名）', 'text', 'reg-realname', 'text'));
    authorFields.appendChild(createFormGroup('住所', 'text', 'reg-address', 'text'));
    authorFields.appendChild(createFormGroup('電話番号', 'tel', 'reg-phone', 'tel'));
    regForm.appendChild(authorFields);

    roleSelect.onchange = function() {
      authorFields.style.display = roleSelect.value === 'author' ? '' : 'none';
    };

    var warning = h('div', { className: 'warning-banner' }, '※Phase 1: データはブラウザのlocalStorageに保存されます。本番環境ではサーバー側で管理されます。');
    regForm.appendChild(warning);

    var regBtn = h('button', { className: 'btn btn-author', style: 'width:100%;justify-content:center' }, '仮登録する');
    regBtn.onclick = function() {
      var regData = {
        displayName: $('#reg-name').value,
        email: $('#reg-email').value,
        password: $('#reg-password').value,
        role: roleSelect.value
      };
      if (roleSelect.value === 'author') {
        regData.realName = $('#reg-realname').value;
        regData.address = $('#reg-address').value;
        regData.phone = $('#reg-phone').value;
      }
      S.register(regData).then(function(res) {
        // Phase 1: 仮登録成功 → 確認画面を表示
        showConfirmationScreen(overlay, content, res.token, regData.email);
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

  // === 仮登録確認画面 ===
  function showConfirmationScreen(overlay, contentEl, token, email) {
    contentEl.innerHTML = '';
    var title = h('div', { className: 'modal-title' });
    title.appendChild(h('span', {}, '仮登録完了'));
    contentEl.appendChild(title);

    var info = h('div', { style: 'text-align:center;padding:20px 0' });
    info.appendChild(h('div', { style: 'font-size:48px;margin-bottom:16px' }, '\u2709\uFE0F'));
    info.appendChild(h('p', { style: 'font-size:15px;margin-bottom:8px;color:var(--text-primary)' }, '確認メールを送信しました'));
    info.appendChild(h('p', { style: 'font-size:13px;color:var(--text-secondary);margin-bottom:20px' }, email + ' に届いたメールの確認URLをクリックして本登録を完了してください。'));

    // Phase 1: 実際のメール送信はないので、「確認する」ボタンで即時本登録
    var notice = h('div', { className: 'warning-banner', style: 'text-align:left' }, 'Phase 1 デモ: 実際のメール送信は行われません。下のボタンで本登録をシミュレートします。');
    info.appendChild(notice);

    var confirmBtn = h('button', { className: 'btn btn-author', style: 'width:100%;justify-content:center;margin-top:12px' }, 'メール確認をシミュレート（本登録）');
    confirmBtn.onclick = function() {
      S.confirmRegistration(token).then(function(user) {
        state.user = user;
        updateAuthUI();
        overlay.remove();
        toast('本登録が完了しました！');
      }).catch(function(err) { toast(err.message); });
    };
    info.appendChild(confirmBtn);
    contentEl.appendChild(info);
  }

  // === パスワード再設定モーダル ===
  function showPasswordResetModal(parentOverlay) {
    if (parentOverlay) parentOverlay.remove();

    var overlay = h('div', { className: 'modal-overlay', id: 'auth-modal' });
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var content = h('div', { className: 'modal-content anim-slide' });
    var title = h('div', { className: 'modal-title' });
    title.appendChild(h('span', {}, 'パスワード再設定'));
    var closeBtn = h('button', { className: 'btn-icon', html: '&times;', style: 'font-size:24px;color:var(--text-primary)' });
    closeBtn.onclick = function() { overlay.remove(); };
    title.appendChild(closeBtn);
    content.appendChild(title);

    var form = h('div', { className: 'auth-form' });
    form.appendChild(h('p', { style: 'font-size:13px;color:var(--text-secondary);margin-bottom:8px' }, '登録済みのメールアドレスを入力してください。パスワード再設定用のメールを送信します。'));
    form.appendChild(createFormGroup('メールアドレス', 'email', 'reset-email', 'email'));

    var sendBtn = h('button', { className: 'btn btn-author', style: 'width:100%;justify-content:center' }, '再設定メールを送信');
    sendBtn.onclick = function() {
      var email = $('#reset-email').value;
      S.requestPasswordReset(email).then(function(res) {
        // Phase 1: 即座に再設定画面を表示
        showNewPasswordScreen(overlay, content, res.token);
      }).catch(function(err) { toast(err.message); });
    };
    form.appendChild(sendBtn);

    var backLink = h('button', {
      style: 'background:none;border:none;color:var(--accent-author);font-size:13px;cursor:pointer;margin-top:8px;text-align:center;width:100%;font-family:inherit'
    }, 'ログイン画面に戻る');
    backLink.onclick = function() { overlay.remove(); showAuthModal(); };
    form.appendChild(backLink);

    content.appendChild(form);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
  }

  // === 新パスワード入力画面 ===
  function showNewPasswordScreen(overlay, contentEl, token) {
    contentEl.innerHTML = '';
    var title = h('div', { className: 'modal-title' });
    title.appendChild(h('span', {}, '新しいパスワード'));
    contentEl.appendChild(title);

    var notice = h('div', { className: 'warning-banner' }, 'Phase 1 デモ: 実際のメール送信は行われません。ここで直接新しいパスワードを設定します。');
    contentEl.appendChild(notice);

    var form = h('div', { className: 'auth-form' });
    form.appendChild(createFormGroup('新しいパスワード（6文字以上）', 'password', 'new-password', 'password'));
    form.appendChild(createFormGroup('パスワード確認', 'password', 'new-password-confirm', 'password'));

    var resetBtn = h('button', { className: 'btn btn-author', style: 'width:100%;justify-content:center' }, 'パスワードを再設定');
    resetBtn.onclick = function() {
      var pw = $('#new-password').value;
      var pwc = $('#new-password-confirm').value;
      if (pw !== pwc) { toast('パスワードが一致しません'); return; }
      S.resetPassword(token, pw).then(function(res) {
        overlay.remove();
        toast(res.message);
        showAuthModal();
      }).catch(function(err) { toast(err.message); });
    };
    form.appendChild(resetBtn);
    contentEl.appendChild(form);
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
