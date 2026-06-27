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
  // === 青空文庫シリーズ コーナー（謝辞付き） ===
  function renderAozoraSeries(works, votes) {
    var existing = document.getElementById('aozora-section');
    if (existing) existing.parentNode.removeChild(existing);
    if (!works || !works.length) return;
    var main = document.getElementById('main');
    if (!main) return;

    var sec = h('section', { className: 'portal-container', id: 'aozora-section' });
    sec.style.marginTop = '8px';

    var title = h('div', { className: 'section-title' });
    title.appendChild(h('span', {}, '📚 青空文庫シリーズ'));
    sec.appendChild(title);

    var lead = h('p', {
      style: 'color:var(--text-secondary);font-size:14px;line-height:1.7;margin:4px 0 16px'
    }, '著作権の保護期間が満了した名作を、アニメ風の語りでお楽しみいただけます。');
    sec.appendChild(lead);

    var grid = h('div', { className: 'works-grid', id: 'aozora-grid' });
    works.slice().sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); })
      .forEach(function(w){ grid.appendChild(createWorkCard(w, votes)); });
    sec.appendChild(grid);

    // 謝辞
    var ack = h('div', {
      style: 'margin-top:16px;padding:14px 16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;font-size:12.5px;line-height:1.8;color:var(--text-muted)'
    });
    ack.innerHTML = '本シリーズの原文は、ボランティアによる電子化ライブラリ「青空文庫」（aozora.gr.jp）のパブリックドメインテキストを利用しています。' +
      '話者の振り分け・キャラクター造形・画面演出はアニノベルによる翻案です。' +
      '貴重な原文を公開してくださっている青空文庫とボランティアの皆さまに感謝いたします。' +
      '<br><a href="https://www.aozora.gr.jp/" target="_blank" rel="noopener" style="color:var(--accent)">青空文庫を開く ↗</a>';
    sec.appendChild(ack);

    // #about-section の直前に挿入（無ければ #main の末尾）
    var about = document.getElementById('about-section');
    if (about && about.parentNode === main) main.insertBefore(sec, about);
    else main.appendChild(sec);
  }

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

  // === ロール表示ヘルパー ===
  var ROLE_META = {
    owner:  { icon: '\uD83D\uDC51', label: 'オーナー', color: '#F59E0B' },
    author: { icon: '\u270F\uFE0F', label: '作者',     color: '#8B5CF6' },
    reader: { icon: '\uD83D\uDCD6', label: '読者',     color: '#3B82F6' }
  };
  function roleOf(u) { return (u && (u.activeRole || u.role)) || 'reader'; }

  // === 認証UI更新 ===
  function updateAuthUI() {
    var container = $('#auth-area');
    if (!container) return;
    container.innerHTML = '';
    document.body.classList.toggle('logged-in', !!(state.user && state.user.loggedIn));
    document.body.classList.toggle('role-author', !!(state.user && (roleOf(state.user) === 'author' || roleOf(state.user) === 'owner')));
    document.body.classList.toggle('role-owner', !!(state.user && roleOf(state.user) === 'owner'));
    updateWelcomeBanner();

    if (state.user && state.user.loggedIn) {
      var badge = h('div', { className: 'user-badge' });
      var ar = roleOf(state.user);
      var rm = ROLE_META[ar] || ROLE_META.reader;
      // モードバッジ（色付き）
      var modeBadge = h('span', {
        className: 'role-mode-badge',
        style: 'background:' + rm.color + ';color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;white-space:nowrap'
      }, rm.icon + ' ' + rm.label + 'モード');
      badge.appendChild(modeBadge);
      badge.appendChild(h('span', { className: 'name', style: 'margin-left:6px' }, state.user.displayName));

      // モード切替ドロップダウン（複数ロール保有時）
      var roles = state.user.roles || [ar];
      if (roles.length > 1) {
        var switchBtn = h('button', { className: 'btn btn-ghost btn-sm', title: 'モード切替', style: 'font-size:13px' }, '\u{1F504}');
        switchBtn.onclick = function() { showRoleSwitchMenu(switchBtn); };
        badge.appendChild(switchBtn);
      } else {
        // 未登録ロールへの追加登録ボタン
        var addLabel = ar === 'reader' ? '作者登録' : '読者登録';
        var addBtn = h('button', { className: 'btn btn-ghost btn-sm', title: addLabel, style: 'font-size:12px' }, '\uFF0B ' + addLabel);
        addBtn.onclick = function() {
          showAuthModal('register');
          setTimeout(function() {
            var sel = document.getElementById('reg-role');
            var af = document.getElementById('author-fields');
            if (sel) { sel.value = ar === 'reader' ? 'author' : 'reader'; if (af) af.style.display = sel.value === 'author' ? '' : 'none'; }
            var em = document.getElementById('reg-email');
            if (em) em.value = state.user.email || '';
          }, 0);
        };
        badge.appendChild(addBtn);
      }

      var dashBtn = h('button', { className: 'btn btn-ghost btn-sm', title: 'ダッシュボード' }, '\u{1F4CA}');
      dashBtn.onclick = showDashboard;
      badge.appendChild(dashBtn);
      if (roles.indexOf('author') >= 0 || roles.indexOf('owner') >= 0) {
        var myBtn = h('button', { className: 'btn btn-ghost btn-sm', title: 'マイ作品' }, '\u270F\uFE0F');
        myBtn.onclick = showMyWorksModal;
        badge.appendChild(myBtn);
      }
      if (roles.indexOf('owner') >= 0) {
        var adminBtn = h('button', { className: 'btn btn-ghost btn-sm', title: '管理パネル', style: 'color:#F59E0B' }, '\uD83D\uDC51');
        adminBtn.onclick = showAdminPanel;
        badge.appendChild(adminBtn);
      }
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

  // === モード切替ポップアップ ===
  function showRoleSwitchMenu(anchor) {
    var old = $('#role-switch-popup');
    if (old) { old.remove(); return; }
    var popup = h('div', { id: 'role-switch-popup', style: 'position:absolute;right:0;top:100%;background:var(--panel-bg);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:999;min-width:180px;padding:6px 0' });
    (state.user.roles || []).forEach(function(r) {
      var m = ROLE_META[r] || ROLE_META.reader;
      var active = roleOf(state.user) === r;
      var item = h('button', {
        style: 'display:flex;align-items:center;gap:8px;width:100%;padding:10px 16px;border:none;background:' + (active ? 'var(--bg-secondary)' : 'none') + ';cursor:pointer;font-size:14px;font-family:inherit;color:var(--text-primary);text-align:left'
      });
      item.appendChild(h('span', {}, m.icon));
      item.appendChild(h('span', { style: 'flex:1' }, m.label + 'モード'));
      if (active) item.appendChild(h('span', { style: 'color:var(--accent);font-size:12px' }, '\u2714'));
      item.onclick = function() {
        popup.remove();
        if (!active) {
          S.switchActiveRole(r).then(function(u) {
            state.user = u;
            updateAuthUI();
            toast(m.icon + ' ' + m.label + 'モードに切り替えました');
          });
        }
      };
      popup.appendChild(item);
    });
    anchor.parentNode.style.position = 'relative';
    anchor.parentNode.appendChild(popup);
    setTimeout(function() { document.addEventListener('click', function handler(e) { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', handler); } }); }, 0);
  }

  // === マイ作品モーダル（作者用） ===
  function showMyWorksModal() {
    var existing = $('#myworks-modal');
    if (existing) existing.remove();
    var overlay = h('div', { className: 'modal-overlay', id: 'myworks-modal' });
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    var content = h('div', { className: 'modal-content anim-slide' });
    var title = h('div', { className: 'modal-title' });
    title.appendChild(h('span', {}, '\u270F\uFE0F マイ作品'));
    var closeBtn = h('button', { className: 'btn-icon', html: '&times;', style: 'font-size:24px;color:var(--text-primary)' });
    closeBtn.onclick = function() { overlay.remove(); };
    title.appendChild(closeBtn);
    content.appendChild(title);

    var listEl = h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-bottom:16px;max-height:50vh;overflow-y:auto' });
    content.appendChild(listEl);

    function refresh() {
      listEl.innerHTML = '';
      S.getMyWorks().then(function(works) {
        if (!works.length) {
          listEl.appendChild(h('p', { style: 'text-align:center;color:var(--text-muted);padding:20px' }, 'まだ作品がありません。下の「新規作成」からはじめましょう。'));
          return;
        }
        works.forEach(function(w) {
          var row = h('div', { style: 'display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);border-radius:8px' });
          var info = h('div', { style: 'flex:1;min-width:0' });
          info.appendChild(h('div', { style: 'font-weight:600' }, w.title));
          info.appendChild(h('div', { style: 'font-size:11px;color:var(--text-muted)' }, '更新: ' + formatDate(w.updatedAt)));
          row.appendChild(info);
          var openBtn = h('button', { className: 'btn btn-author btn-sm' }, '\u270F\uFE0F 編集');
          openBtn.onclick = function() { window.location.href = 'viewer.html?work=' + encodeURIComponent(w.id); };
          row.appendChild(openBtn);
          // 投稿/取り下げボタン
          (function(wid, wTitle) {
            S.isPublished(wid).then(function(isPub) {
              if (isPub) {
                var unpubBtn = h('button', { className: 'btn btn-ghost btn-sm', style: 'color:#F59E0B;font-size:11px', title: '投稿を取り下げる' }, '\u{1F4E5} 取下');
                unpubBtn.onclick = function(e) {
                  e.stopPropagation();
                  if (!confirm('「' + wTitle + '」の投稿を取り下げますか？')) return;
                  S.unpublishWork(wid).then(function() { toast('取り下げました'); refresh(); });
                };
                row.insertBefore(unpubBtn, row.lastChild);
                info.appendChild(h('span', { style: 'font-size:10px;color:#059669;font-weight:700' }, ' \u2714 投稿済'));
              } else {
                var pubBtn = h('button', { className: 'btn btn-ghost btn-sm', style: 'color:#6366F1;font-size:11px', title: '読者に公開する' }, '\u{1F4E4} 投稿');
                pubBtn.onclick = function(e) {
                  e.stopPropagation();
                  if (!w.data || !w.data.content || w.data.content.length === 0) { toast('コンテンツがない作品は投稿できません'); return; }
                  if (!confirm('「' + wTitle + '」を投稿しますか？\n読者が読んで評価できるようになります。')) return;
                  S.publishWork(wid).then(function() { toast('投稿しました！'); refresh(); });
                };
                row.insertBefore(pubBtn, row.lastChild);
              }
            });
          })(w.id, w.title);
          var delBtn = h('button', { className: 'btn btn-ghost btn-sm', style: 'color:#DC2626' }, '\u{1F5D1}\uFE0F');
          delBtn.onclick = function() {
            if (!confirm('「' + w.title + '」を削除しますか？')) return;
            S.deleteMyWork(w.id).then(function() { toast('削除しました'); refresh(); });
          };
          row.appendChild(delBtn);
          listEl.appendChild(row);
        });
      });
    }
    refresh();

    var createBtn = h('button', { className: 'btn btn-primary', style: 'width:100%;justify-content:center' }, '\uFF0B 新規作品を作成');
    createBtn.onclick = function() {
      var title = prompt('作品タイトルを入力してください', '新しい作品');
      if (!title) return;
      S.createMyWork({ title: title }).then(function(w) {
        toast('作成しました');
        window.location.href = 'viewer.html?work=' + encodeURIComponent(w.id);
      });
    };
    content.appendChild(createBtn);

    overlay.appendChild(content);
    document.body.appendChild(overlay);
  }

  // === ダッシュボード（しおり・投票履歴） ===
  function showDashboard() {
    var existing = $('#dashboard-modal');
    if (existing) existing.remove();
    var overlay = h('div', { className: 'modal-overlay', id: 'dashboard-modal' });
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    var content = h('div', { className: 'modal-content anim-slide', style: 'max-width:640px' });
    var title = h('div', { className: 'modal-title' });
    title.appendChild(h('span', {}, '\u{1F4CA} マイダッシュボード'));
    var closeBtn = h('button', { className: 'btn-icon', html: '&times;', style: 'font-size:24px;color:var(--text-primary)' });
    closeBtn.onclick = function() { overlay.remove(); };
    title.appendChild(closeBtn);
    content.appendChild(title);

    Promise.all([S.getCatalog(), S.getVotes()]).then(function(r) {
      var catalog = r[0], votes = r[1];
      // 投票履歴
      var votedSection = h('div', { style: 'margin-bottom:20px' });
      votedSection.appendChild(h('h4', { style: 'margin-bottom:8px' }, '\u2764\uFE0F 投票した作品'));
      var voted = catalog.works.filter(function(w) { return votes[w.id] && votes[w.id].userVoted; });
      if (!voted.length) votedSection.appendChild(h('p', { style: 'color:var(--text-muted);font-size:13px' }, '投票した作品はまだありません。'));
      else voted.forEach(function(w) {
        var row = h('div', { style: 'display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;cursor:pointer' });
        row.onclick = function() { window.location.href = 'viewer.html?work=' + encodeURIComponent(w.id); };
        row.appendChild(h('span', {}, w.title + ' / ' + w.author));
        votedSection.appendChild(row);
      });
      content.appendChild(votedSection);

      // しおり
      var bmSection = h('div', {});
      bmSection.appendChild(h('h4', { style: 'margin-bottom:8px' }, '\u{1F516} しおり'));
      var all = JSON.parse(localStorage.getItem('aninovel_bookmarks') || '{}');
      var hasAny = false;
      catalog.works.forEach(function(w) {
        var bms = all[w.id] || [];
        if (!bms.length) return;
        hasAny = true;
        bmSection.appendChild(h('div', { style: 'font-weight:600;margin-top:8px' }, w.title));
        bms.forEach(function(bm) {
          var row = h('div', { style: 'padding:6px 12px;border-left:3px solid var(--accent,#6366F1);margin:4px 0;cursor:pointer;font-size:13px' });
          row.onclick = function() { window.location.href = 'viewer.html?work=' + encodeURIComponent(w.id); };
          row.appendChild(h('span', {}, bm.title + ' (p.' + (bm.page + 1) + ')'));
          bmSection.appendChild(row);
        });
      });
      if (!hasAny) bmSection.appendChild(h('p', { style: 'color:var(--text-muted);font-size:13px' }, 'しおりはまだありません。'));
      content.appendChild(bmSection);
    });

    overlay.appendChild(content);
    document.body.appendChild(overlay);
  }

  // === ウェルカムバナー（ログイン後の表示切替） ===
  function updateWelcomeBanner() {
    var hero = document.querySelector('.portal-hero');
    if (!hero) return;
    var existing = document.getElementById('welcome-banner');
    if (state.user && state.user.loggedIn) {
      var ar = roleOf(state.user);
      var rm = ROLE_META[ar] || ROLE_META.reader;
      var rolesLabel = (state.user.roles || [ar]).map(function(r) { return (ROLE_META[r] || {}).label || r; }).join(' / ');
      var tips = ar === 'owner'
        ? '\uD83D\uDC51 管理パネルでユーザー・作品を管理できます。✏️ マイ作品、📊 ダッシュボードも利用可能です。'
        : ar === 'author'
        ? 'ヘッダー右上の ✏️ から「マイ作品」を開いて新規作成・編集、📊 からダッシュボードを確認できます。'
        : 'しおり・投票・キャラカスタマイズが使えます。📊 からダッシュボードを確認できます。';
      if (existing) existing.remove();
      var banner = h('div', { id: 'welcome-banner', className: 'welcome-banner' });
      banner.style.background = ar === 'owner' ? 'linear-gradient(135deg,#F59E0B,#D97706)' : '';
      banner.appendChild(h('div', { className: 'welcome-title' }, rm.icon + ' おかえりなさい、' + state.user.displayName + ' さん'));
      banner.appendChild(h('div', { className: 'welcome-role' }, '現在のモード: ' + rm.label + '（登録ロール: ' + rolesLabel + '）'));
      banner.appendChild(h('div', { className: 'welcome-tips' }, tips));
      hero.style.display = 'none';
      hero.parentNode.insertBefore(banner, hero);
      var aboutTitle = document.querySelector('.section-title');
      var aboutSec = aboutTitle && aboutTitle.parentElement;
      if (aboutSec) aboutSec.style.display = 'none';
    } else {
      if (existing) existing.remove();
      hero.style.display = '';
      var aboutTitle2 = document.querySelector('.section-title');
      var aboutSec2 = aboutTitle2 && aboutTitle2.parentElement;
      if (aboutSec2) aboutSec2.style.display = '';
    }
  }

  // === オーナー管理パネル ===
  function showAdminPanel() {
    var existing = $('#admin-modal');
    if (existing) existing.remove();
    var overlay = h('div', { className: 'modal-overlay', id: 'admin-modal' });
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    var content = h('div', { className: 'modal-content anim-slide', style: 'max-width:720px' });
    var title = h('div', { className: 'modal-title' });
    title.appendChild(h('span', {}, '\uD83D\uDC51 管理パネル'));
    var closeBtn = h('button', { className: 'btn-icon', html: '&times;', style: 'font-size:24px;color:var(--text-primary)' });
    closeBtn.onclick = function() { overlay.remove(); };
    title.appendChild(closeBtn);
    content.appendChild(title);

    // タブ
    var tabs = h('div', { style: 'display:flex;gap:4px;margin-bottom:16px' });
    var tabUsers = h('button', { className: 'btn btn-ghost btn-sm active', style: 'flex:1' }, '\uD83D\uDC65 ユーザー管理');
    var tabWorks = h('button', { className: 'btn btn-ghost btn-sm', style: 'flex:1' }, '\uD83D\uDCDA 作品管理');
    tabs.appendChild(tabUsers);
    tabs.appendChild(tabWorks);
    content.appendChild(tabs);

    var panel = h('div', { id: 'admin-panel-body', style: 'max-height:60vh;overflow-y:auto' });
    content.appendChild(panel);

    function renderUsersTab(filter) {
      panel.innerHTML = '';
      var filterRow = h('div', { style: 'display:flex;gap:6px;margin-bottom:12px' });
      ['all', 'reader', 'author'].forEach(function(f) {
        var btn = h('button', { className: 'btn btn-ghost btn-sm' + (filter === f ? ' active' : ''), style: 'font-size:12px' });
        btn.textContent = f === 'all' ? '全て' : f === 'reader' ? '読者' : '作者';
        btn.onclick = function() { renderUsersTab(f); };
        filterRow.appendChild(btn);
      });
      panel.appendChild(filterRow);

      S.adminListUsers(filter === 'all' ? null : filter).then(function(users) {
        if (!users.length) { panel.appendChild(h('p', { style: 'text-align:center;color:var(--text-muted);padding:20px' }, 'ユーザーがいません')); return; }
        users.forEach(function(u) {
          var row = h('div', { style: 'display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px' + (u.suspended ? ';opacity:0.5' : '') });
          var rolesText = (u.roles || []).map(function(r) { return (ROLE_META[r] || {}).icon || r; }).join(' ');
          row.appendChild(h('span', { style: 'font-size:16px' }, rolesText));
          var info = h('div', { style: 'flex:1;min-width:0' });
          info.appendChild(h('div', { style: 'font-weight:600;font-size:14px' }, u.displayName + (u.suspended ? ' (停止中)' : '')));
          info.appendChild(h('div', { style: 'font-size:12px;color:var(--text-muted)' }, u.email + ' / 登録: ' + formatDate(u.createdAt)));
          row.appendChild(info);
          // オーナー自身は停止不可
          if ((u.roles || []).indexOf('owner') < 0) {
            if (u.suspended) {
              var reactBtn = h('button', { className: 'btn btn-ghost btn-sm', style: 'color:#059669;font-size:12px' }, '\u25B6 復活');
              reactBtn.onclick = function() { S.adminSetSuspended(u.email, false).then(function() { toast('復活しました'); renderUsersTab(filter); }); };
              row.appendChild(reactBtn);
            } else {
              var suspBtn = h('button', { className: 'btn btn-ghost btn-sm', style: 'color:#DC2626;font-size:12px' }, '\u23F8 停止');
              suspBtn.onclick = function() {
                if (!confirm(u.displayName + ' を停止しますか？')) return;
                S.adminSetSuspended(u.email, true).then(function() { toast('停止しました'); renderUsersTab(filter); });
              };
              row.appendChild(suspBtn);
            }
          }
          panel.appendChild(row);
        });
      });
    }

    function renderWorksTab() {
      panel.innerHTML = '';
      S.adminListAllWorks().then(function(works) {
        if (!works.length) { panel.appendChild(h('p', { style: 'text-align:center;color:var(--text-muted);padding:20px' }, '作品がありません')); return; }
        works.forEach(function(w) {
          var row = h('div', { style: 'display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px' + (w.suspended ? ';opacity:0.5' : '') });
          var info = h('div', { style: 'flex:1;min-width:0' });
          info.appendChild(h('div', { style: 'font-weight:600;font-size:14px' }, w.title + (w.suspended ? ' (公開停止)' : '')));
          info.appendChild(h('div', { style: 'font-size:12px;color:var(--text-muted)' }, '作者: ' + w.authorName + (w.authorEmail ? ' (' + w.authorEmail + ')' : '') + ' \u00B7 ' + (w.source === 'server' ? '\uD83C\uDF10 公開中(サーバー)' : '\u270F\uFE0F ローカル下書き')));
          row.appendChild(info);
          if (w.source === 'server') {
            if (w.suspended) {
              var resumeBtn = h('button', { className: 'btn btn-ghost btn-sm', style: 'color:#059669;font-size:12px' }, '\u25B6 再開');
              resumeBtn.onclick = function() { S.adminSetWorkSuspended(w.id, false).then(function() { toast('再開しました'); renderWorksTab(); }); };
              row.appendChild(resumeBtn);
            } else {
              var stopBtn = h('button', { className: 'btn btn-ghost btn-sm', style: 'color:#DC2626;font-size:12px' }, '\u23F8 公開停止');
              stopBtn.onclick = function() {
                if (!confirm('「' + w.title + '」を公開停止しますか？')) return;
                S.adminSetWorkSuspended(w.id, true).then(function() { toast('公開停止しました'); renderWorksTab(); });
              };
              row.appendChild(stopBtn);
            }
          }
          if (w.source === 'server') {
            var delBtn = h('button', { className: 'btn btn-ghost btn-sm', style: 'color:#DC2626;font-size:12px' }, '\uD83D\uDDD1 削除');
            delBtn.onclick = function() {
              if (!confirm('「' + w.title + '」をサーバーから完全に削除しますか？\nこの操作は取り消せません。')) return;
              S.adminDeleteWork(w.id).then(function(res) {
                toast(res && res.serverSynced ? '削除しました' : '削除しました（サーバー未同期の可能性）');
                renderWorksTab();
              }).catch(function(e) { toast(e.message || '削除に失敗しました'); });
            };
            row.appendChild(delBtn);
          }
          var openBtn = h('button', { className: 'btn btn-ghost btn-sm', style: 'font-size:12px' }, '\uD83D\uDD0D');
          openBtn.onclick = function() { window.location.href = 'viewer.html?work=' + encodeURIComponent(w.id); };
          row.appendChild(openBtn);
          panel.appendChild(row);
        });
      });
    }

    tabUsers.onclick = function() { tabUsers.classList.add('active'); tabWorks.classList.remove('active'); renderUsersTab('all'); };
    tabWorks.onclick = function() { tabWorks.classList.add('active'); tabUsers.classList.remove('active'); renderWorksTab(); };
    renderUsersTab('all');

    overlay.appendChild(content);
    document.body.appendChild(overlay);
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

      // 作品一覧（新着順にソート）。青空文庫シリーズ（tags に「青空文庫」を含む）は別枠に分離。
      function _isAozora(w){return (w.tags||[]).indexOf('青空文庫')>=0;}
      var grid = $('#works-grid');
      if (grid) {
        var sorted = catalog.works.slice().sort(function(a, b) {
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
        sorted.filter(function(w){return !_isAozora(w);}).forEach(function(w) {
          grid.appendChild(createWorkCard(w, votes));
        });
      }

      // 青空文庫シリーズ コーナー（謝辞付き）
      renderAozoraSeries(catalog.works.filter(_isAozora), votes);

      // ランキング
      renderRanking('votes');
    });

    // ランキングソートボタン
    $$('.ranking-sort-btn').forEach(function(btn) {
      btn.onclick = function() { renderRanking(btn.dataset.sort); };
    });

    // フッター「ログイン/新規登録」リンク
    var footerLogin = $('#footer-login-link');
    if (footerLogin) footerLogin.onclick = function(e) { e.preventDefault(); showAuthModal('login'); };

    // モードカード内「新規登録」「ログイン」ボタン
    $$('.mode-register-btn').forEach(function(btn) {
      btn.onclick = function() {
        showAuthModal('register');
        // 指定ロールをプリセット
        setTimeout(function() {
          var sel = document.getElementById('reg-role');
          var authorFields = document.getElementById('author-fields');
          if (sel) {
            sel.value = btn.dataset.role || 'reader';
            if (authorFields) authorFields.style.display = sel.value === 'author' ? '' : 'none';
          }
        }, 0);
      };
    });
    $$('.mode-login-btn').forEach(function(btn) {
      btn.onclick = function() { showAuthModal('login'); };
    });
    $$('.mode-mywork-btn').forEach(function(btn) {
      btn.onclick = function() {
        if (!state.user || !state.user.loggedIn) { toast('作者ログインが必要です'); showAuthModal('login'); return; }
        var r = state.user.roles || [state.user.role];
        if (r.indexOf('author') < 0 && r.indexOf('owner') < 0) { toast('作者アカウントのみ利用できます'); return; }
        showMyWorksModal();
      };
    });

    // URL ハッシュ経由で登録モーダル直リンク
    if (location.hash === '#register-author') {
      setTimeout(function() {
        showAuthModal('register');
        var sel = document.getElementById('reg-role');
        var authorFields = document.getElementById('author-fields');
        if (sel) { sel.value = 'author'; if (authorFields) authorFields.style.display = ''; }
      }, 50);
    } else if (location.hash === '#register-reader') {
      setTimeout(function() { showAuthModal('register'); }, 50);
    } else if (location.hash === '#login') {
      setTimeout(function() { showAuthModal('login'); }, 50);
    }
  }

  // グローバルに公開（他ページからのリンクで利用）
  window.AninovelPortal = { showAuthModal: showAuthModal };

  // DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
