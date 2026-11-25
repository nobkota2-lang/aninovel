/* ============================================================
 * AniNovel 評価・口コミ / 作者への指摘・感想   (js/feedback.js)
 * ------------------------------------------------------------
 * 読者向けの窓口。viewer.html から defer で読み込む。
 *
 *  ・画面右下に「💬」ボタンを出す(公開作品を読者として読んでいるときだけ)
 *  ・押すと2つのタブを持つ窓が開く
 *      ⭐ 評価・口コミ   … 公開。★1〜5と短い口コミ。1人1作品1件(書き直し可)。ログイン必須
 *      ✉️ 作者へ届ける  … 非公開。誤字脱字・矛盾の指摘や感想。作者だけが読む。ログイン不要
 *  ・返信やスレッドは持たない(言い合いを生まないため)
 *  ・本文を選択してから開くと、その部分を「該当箇所」として自動で引用する
 *
 * 英語表示(state.lang==='en')では日本語を一切出さない。
 * ============================================================ */
(function () {
  'use strict';
  if (window.AninovelFeedback) return;

  var T = {
    ja: {
      fab: '評価・感想', tabRev: '⭐ 評価・口コミ', tabFb: '✉️ 作者へ届ける', close: '閉じる',
      avg: '平均', count: '件', none: 'まだ口コミはありません。最初の1件をどうぞ。',
      yourStars: 'あなたの評価', yourText: 'ひとこと口コミ(任意・400字まで)',
      revHint: '公開されます。返信の機能はありません。作品の良かった点や、読む人への道しるべになる感想をお願いします。',
      post: '投稿する', update: '書き直す', withdraw: '取り下げる', needLogin: '評価・口コミには読者登録(無料)とログインが必要です。',
      login: 'ログイン / 読者登録', mineHidden: '(この口コミは運営の判断で非表示になっています)',
      fbIntro: 'ここに書いた内容は作者だけに届きます(公開されません)。誤字脱字や矛盾のご指摘、感想・要望をお寄せください。作者からの返信はありません。',
      kind: '種類', quote: '該当箇所(本文を選択してから開くと自動で入ります)', text: '内容(1000字まで)',
      send: '作者に送る', sent: '作者に届けました。ありがとうございます。', page: 'ページ',
      kinds: { typo: '誤字・脱字', conflict: '矛盾・設定のずれ', fact: '事実・用語の誤り', impression: '感想', request: '要望・提案', other: 'その他' },
      starsLabel: ['', 'いまひとつ', 'もう少し', 'ふつう', 'よかった', 'とてもよかった'],
      err: '送信できませんでした。時間をおいてもう一度お試しください。', pickStars: '★を選んでください。', writeSomething: '内容を書いてください。',
      confirmWithdraw: '口コミを取り下げますか?', edited: '(編集済み)', report: '通報', hiddenTag: '非表示中', hide: '非表示', unhide: '再表示'
    },
    en: {
      fab: 'Rate & Feedback', tabRev: '⭐ Ratings & Reviews', tabFb: '✉️ Note to the Author', close: 'Close',
      avg: 'Average', count: 'reviews', none: 'No reviews yet. Be the first to write one.',
      yourStars: 'Your rating', yourText: 'Short review (optional, up to 400 characters)',
      revHint: 'Reviews are public. There are no replies. Please share what you enjoyed and what would help other readers.',
      post: 'Post', update: 'Update', withdraw: 'Withdraw', needLogin: 'Please sign in (free reader account) to rate and review.',
      login: 'Sign in / Register', mineHidden: '(This review has been hidden by the moderators)',
      fbIntro: 'Only the author can read what you write here (it is not published). Typos, inconsistencies, impressions and suggestions are all welcome. The author does not reply.',
      kind: 'Type', quote: 'Passage (select text in the story before opening to fill this in)', text: 'Message (up to 1000 characters)',
      send: 'Send to the author', sent: 'Sent to the author. Thank you!', page: 'Page',
      kinds: { typo: 'Typo / missing word', conflict: 'Inconsistency', fact: 'Factual error', impression: 'Impression', request: 'Suggestion', other: 'Other' },
      starsLabel: ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'],
      err: 'Could not send. Please try again later.', pickStars: 'Please choose a star rating.', writeSomething: 'Please write something.',
      confirmWithdraw: 'Withdraw your review?', edited: '(edited)', report: 'Report', hiddenTag: 'hidden', hide: 'Hide', unhide: 'Show'
    }
  };
  function L() { return (window.state && state.lang === 'en') ? 'en' : 'ja'; }
  function t(k) { return T[L()][k]; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function workId() { return (typeof _workParam !== 'undefined' && _workParam) ? _workParam : null; }
  function readerMode() { return !!workId() && !(window.state && state.isAuthorMode); }
  function serverMsg(j, fallback) {
    // サーバの文言は日本語。英語表示ではこちらの英語の定型文を使う。
    if (L() === 'en') return fallback;
    return (j && j.message) || fallback;
  }

  var css = '' +
    '#anfb-fab{position:fixed;right:16px;bottom:84px;z-index:60;border:none;border-radius:24px;padding:10px 14px;font-size:14px;font-weight:600;cursor:pointer;background:var(--accent,#e8743b);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.25)}' +
    '#anfb-fab.pulse{animation:anfbp 1.6s ease-in-out 3}' +
    '@keyframes anfbp{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}' +
    '#anfb-ov{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}' +
    '@media(min-width:700px){#anfb-ov{align-items:center}}' +
    '#anfb-box{background:var(--bg-primary,#fff);color:var(--text-primary,#222);width:100%;max-width:560px;max-height:88vh;overflow:auto;border-radius:14px 14px 0 0;padding:0 0 16px}' +
    '@media(min-width:700px){#anfb-box{border-radius:14px}}' +
    '#anfb-box .hd{display:flex;gap:4px;padding:10px 10px 0;border-bottom:1px solid var(--border,#ddd);position:sticky;top:0;background:inherit}' +
    '#anfb-box .tab{flex:1;border:none;background:none;padding:10px 6px;font-size:14px;cursor:pointer;color:var(--text-secondary,#666);border-bottom:3px solid transparent}' +
    '#anfb-box .tab.on{color:var(--text-primary,#222);font-weight:700;border-bottom-color:var(--accent,#e8743b)}' +
    '#anfb-box .x{border:none;background:none;font-size:18px;cursor:pointer;color:var(--text-muted,#999);padding:6px 10px}' +
    '#anfb-box .bd{padding:14px 16px}' +
    '#anfb-box .note{font-size:12px;color:var(--text-muted,#888);line-height:1.6;margin:0 0 10px}' +
    '#anfb-box .stars{font-size:30px;letter-spacing:4px;cursor:pointer;user-select:none}' +
    '#anfb-box .stars span{color:#ccc}#anfb-box .stars span.on{color:#f5a623}' +
    '#anfb-box textarea,#anfb-box select,#anfb-box input{width:100%;box-sizing:border-box;border:1px solid var(--border,#ccc);border-radius:8px;padding:8px;font-size:14px;background:var(--bg-secondary,#fafafa);color:inherit}' +
    '#anfb-box label{display:block;font-size:12px;color:var(--text-secondary,#666);margin:10px 0 4px}' +
    '#anfb-box .btn{border:none;border-radius:8px;padding:9px 16px;font-size:14px;cursor:pointer;background:var(--accent,#e8743b);color:#fff;margin-top:12px}' +
    '#anfb-box .btn.sub{background:var(--bg-secondary,#eee);color:var(--text-primary,#333)}' +
    '#anfb-box .sum{display:flex;align-items:center;gap:14px;margin-bottom:12px}' +
    '#anfb-box .big{font-size:34px;font-weight:700}' +
    '#anfb-box .bar{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted,#888)}' +
    '#anfb-box .bar i{display:block;height:6px;background:#f5a623;border-radius:3px}' +
    '#anfb-box .rv{border-top:1px solid var(--border,#eee);padding:10px 0;font-size:14px;line-height:1.6}' +
    '#anfb-box .rv .m{font-size:11px;color:var(--text-muted,#999)}' +
    '#anfb-box .msg{font-size:13px;margin-top:8px}' +
    '#anfb-box .lnk{border:none;background:none;color:var(--text-muted,#999);font-size:11px;cursor:pointer;text-decoration:underline;padding:0 4px}';

  function starStr(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆'; return s; }

  var cur = { tab: 'rev', quote: '', itemId: '', page: null, stars: 0, data: null };

  function captureSelection() {
    var q = '', id = '';
    try {
      var sel = window.getSelection && window.getSelection();
      q = sel ? String(sel.toString()).trim().slice(0, 300) : '';
    } catch (e) {}
    if (q && typeof getPC === 'function') {
      try {
        var items = getPC() || [];
        var key = q.replace(/\s+/g, '').slice(0, 20);
        for (var i = 0; i < items.length; i++) {
          var tx = (typeof _ctext === 'function') ? _ctext(items[i]) : items[i].text;
          if (String(tx || '').replace(/\s+/g, '').indexOf(key) >= 0) { id = items[i].id; break; }
        }
      } catch (e) {}
    }
    cur.quote = q; cur.itemId = id;
    cur.page = (window.state && typeof state.currentPage === 'number') ? state.currentPage + 1 : null;
  }

  function open(tab) {
    if (!readerMode()) return;
    captureSelection();
    cur.tab = tab || (cur.quote ? 'fb' : 'rev');
    var ov = document.getElementById('anfb-ov');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'anfb-ov';
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      document.body.appendChild(ov);
    }
    draw();
    if (cur.tab === 'rev') loadReviews();
  }
  function close() { var ov = document.getElementById('anfb-ov'); if (ov) ov.remove(); }

  function draw() {
    var ov = document.getElementById('anfb-ov'); if (!ov) return;
    ov.innerHTML = '<div id="anfb-box" role="dialog" aria-modal="true"><div class="hd">' +
      '<button class="tab' + (cur.tab === 'rev' ? ' on' : '') + '" data-anfb="tab-rev">' + esc(t('tabRev')) + '</button>' +
      '<button class="tab' + (cur.tab === 'fb' ? ' on' : '') + '" data-anfb="tab-fb">' + esc(t('tabFb')) + '</button>' +
      '<button class="x" data-anfb="close" aria-label="' + esc(t('close')) + '">✕</button></div>' +
      '<div class="bd">' + (cur.tab === 'rev' ? revHtml() : fbHtml()) + '</div></div>';
  }

  // ---------- 評価・口コミ ----------
  function loggedIn() { try { return typeof _isLoggedIn === 'function' ? _isLoggedIn() : false; } catch (e) { return false; } }

  function revHtml() {
    var d = cur.data;
    if (!d) return '<p class="note">…</p>';
    var s = d.summary || { n: 0, avg: 0, dist: [0, 0, 0, 0, 0] };
    var h = '<div class="sum"><div class="big">' + (s.n ? s.avg.toFixed(1) : '–') + '</div><div>' +
      '<div style="color:#f5a623;font-size:18px">' + starStr(Math.round(s.avg || 0)) + '</div>' +
      '<div class="note" style="margin:0">' + esc(t('avg')) + ' · ' + s.n + ' ' + esc(t('count')) + '</div></div><div style="flex:1">';
    for (var k = 5; k >= 1; k--) {
      var c = (s.dist || [])[k - 1] || 0, w = s.n ? Math.round(c / s.n * 100) : 0;
      h += '<div class="bar">' + k + '★<span style="flex:1;background:var(--bg-secondary,#eee);border-radius:3px"><i style="width:' + w + '%"></i></span>' + c + '</div>';
    }
    h += '</div></div>';

    // 投稿欄
    if (!loggedIn()) {
      var next = encodeURIComponent(location.pathname + location.search);
      h += '<p class="note">' + esc(t('needLogin')) + '</p><a class="btn" style="display:inline-block;text-decoration:none" href="/login.html?next=' + next + '">' + esc(t('login')) + '</a>';
    } else {
      var mine = d.mine;
      if (!cur.stars && mine) cur.stars = mine.stars;
      h += '<label>' + esc(t('yourStars')) + '</label><div class="stars" data-anfb="stars">';
      for (var i = 1; i <= 5; i++) h += '<span data-anfb="star" data-n="' + i + '" class="' + (i <= cur.stars ? 'on' : '') + '">★</span>';
      h += '</div><div class="note" style="margin:2px 0 0">' + esc(t('starsLabel')[cur.stars] || '') + '</div>' +
        '<label>' + esc(t('yourText')) + '</label><textarea id="anfb-rtext" rows="3" maxlength="400">' + esc(mine ? mine.text : '') + '</textarea>' +
        '<p class="note" style="margin-top:6px">' + esc(t('revHint')) + '</p>' +
        (mine && mine.hidden ? '<p class="note">' + esc(t('mineHidden')) + '</p>' : '') +
        '<button class="btn" data-anfb="rpost">' + esc(mine ? t('update') : t('post')) + '</button>' +
        (mine ? ' <button class="btn sub" data-anfb="rdel">' + esc(t('withdraw')) + '</button>' : '') +
        '<div class="msg" id="anfb-rmsg"></div>';
    }

    // 一覧
    var list = d.reviews || [];
    h += '<div style="margin-top:16px">';
    if (!list.length) h += '<p class="note">' + esc(t('none')) + '</p>';
    list.forEach(function (r) {
      h += '<div class="rv"><div><span style="color:#f5a623">' + starStr(r.stars) + '</span> <b>' + esc(r.nick) + '</b>' +
        (r.hidden ? ' <span class="m">[' + esc(t('hiddenTag')) + ']</span>' : '') + '</div>' +
        (r.text ? '<div style="white-space:pre-wrap">' + esc(r.text) + '</div>' : '') +
        '<div class="m">' + esc(String(r.at || '').slice(0, 10)) + (r.edited ? ' ' + esc(t('edited')) : '') +
        ' <button class="lnk" data-anfb="report" data-rid="' + esc(r.rid) + '">' + esc(t('report')) + '</button>' +
        (d.isOwner ? ' <button class="lnk" data-anfb="mod" data-rid="' + esc(r.rid) + '" data-hide="' + (r.hidden ? '0' : '1') + '">' + esc(r.hidden ? t('unhide') : t('hide')) + '</button>' : '') +
        '</div></div>';
    });
    return h + '</div>';
  }

  function loadReviews() {
    var w = workId(); if (!w) return;
    fetch('/api/reviews?workId=' + encodeURIComponent(w), { credentials: 'include', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { cur.data = j || {}; if (cur.tab === 'rev') draw(); })
      .catch(function () { cur.data = { summary: { n: 0, avg: 0, dist: [0, 0, 0, 0, 0] }, reviews: [] }; draw(); });
  }

  function postReview() {
    var msg = document.getElementById('anfb-rmsg');
    if (!cur.stars) { msg.textContent = t('pickStars'); return; }
    var text = (document.getElementById('anfb-rtext') || {}).value || '';
    fetch('/api/reviews', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workId: workId(), stars: cur.stars, text: text, lang: L() })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) { msg.textContent = serverMsg(x.j, t('err')); return; }
        cur.data = null; loadReviews();
      }).catch(function () { msg.textContent = t('err'); });
  }
  function withdraw() {
    if (!confirm(t('confirmWithdraw'))) return;
    fetch('/api/reviews?workId=' + encodeURIComponent(workId()), { method: 'DELETE', credentials: 'include' })
      .then(function () { cur.stars = 0; cur.data = null; loadReviews(); });
  }
  function moderate(rid, hide) {
    fetch('/api/reviews', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workId: workId(), rid: rid, hidden: hide }) }).then(function () { loadReviews(); });
  }
  function report(rid) {
    if (window.AninovelModeration && AninovelModeration.openReportDialog) {
      close();
      AninovelModeration.openReportDialog({ workId: workId(), targetType: 'review', targetId: workId() + ':' + rid, ctx: 'review' });
    }
  }

  // ---------- 作者へ届ける ----------
  function fbHtml() {
    var ks = t('kinds'), opts = '';
    var def = cur.quote ? 'typo' : 'impression';
    Object.keys(ks).forEach(function (k) { opts += '<option value="' + k + '"' + (k === def ? ' selected' : '') + '>' + esc(ks[k]) + '</option>'; });
    return '<p class="note">' + esc(t('fbIntro')) + '</p>' +
      '<label>' + esc(t('kind')) + '</label><select id="anfb-kind">' + opts + '</select>' +
      '<label>' + esc(t('quote')) + (cur.page ? ' · ' + esc(t('page')) + ' ' + cur.page : '') + '</label>' +
      '<textarea id="anfb-quote" rows="2" maxlength="300">' + esc(cur.quote) + '</textarea>' +
      '<label>' + esc(t('text')) + '</label><textarea id="anfb-text" rows="5" maxlength="1000"></textarea>' +
      '<button class="btn" data-anfb="fsend">' + esc(t('send')) + '</button><div class="msg" id="anfb-fmsg"></div>';
  }
  function sendFb() {
    var msg = document.getElementById('anfb-fmsg');
    var text = (document.getElementById('anfb-text') || {}).value || '';
    if (text.trim().length < 2) { msg.textContent = t('writeSomething'); return; }
    var btn = document.querySelector('[data-anfb="fsend"]'); if (btn) btn.disabled = true;
    fetch('/api/feedback', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workId: workId(), kind: document.getElementById('anfb-kind').value, text: text,
        quote: (document.getElementById('anfb-quote') || {}).value || '', itemId: cur.itemId, page: cur.page, lang: L()
      })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (btn) btn.disabled = false;
        if (!x.ok) { msg.textContent = serverMsg(x.j, t('err')); return; }
        msg.textContent = t('sent');
        document.getElementById('anfb-text').value = ''; document.getElementById('anfb-quote').value = '';
        cur.quote = ''; cur.itemId = '';
      }).catch(function () { if (btn) btn.disabled = false; msg.textContent = t('err'); });
  }

  // ---------- イベント(data属性 + 委譲。onclick に文字列を埋め込まない) ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-anfb]'); if (!el) return;
    var a = el.getAttribute('data-anfb');
    if (a === 'fab') { open(); return; }
    if (a === 'close') { close(); return; }
    if (a === 'tab-rev') { cur.tab = 'rev'; draw(); if (!cur.data) loadReviews(); return; }
    if (a === 'tab-fb') { cur.tab = 'fb'; draw(); return; }
    if (a === 'star') { cur.stars = +el.getAttribute('data-n'); draw(); return; }
    if (a === 'rpost') { postReview(); return; }
    if (a === 'rdel') { withdraw(); return; }
    if (a === 'fsend') { sendFb(); return; }
    if (a === 'report') { report(el.getAttribute('data-rid')); return; }
    if (a === 'mod') { moderate(el.getAttribute('data-rid'), el.getAttribute('data-hide') === '1'); return; }
  });
  // 「💬」ボタンを押すと選択が外れるので、押す前(mousedown)に選択を控えておく
  document.addEventListener('mousedown', function (e) {
    var el = e.target.closest && e.target.closest('#anfb-fab'); if (el) captureSelection();
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  // ---------- 右下のボタンを出し入れする ----------
  function syncFab() {
    var fab = document.getElementById('anfb-fab');
    if (!readerMode()) { if (fab) fab.remove(); return; }
    if (!fab) {
      fab = document.createElement('button'); fab.id = 'anfb-fab'; fab.setAttribute('data-anfb', 'fab');
      document.body.appendChild(fab);
    }
    var label = '💬 ' + t('fab');
    if (fab.textContent !== label) fab.textContent = label;
    // 最後のページに来たら、軽く知らせる(1回だけ)
    try {
      if (!syncFab.pulsed && typeof getTP === 'function' && state.currentPage >= getTP() - 1) {
        syncFab.pulsed = true; fab.classList.add('pulse');
      }
    } catch (e) {}
  }

  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  setInterval(syncFab, 1500);
  if (document.readyState !== 'loading') syncFab(); else document.addEventListener('DOMContentLoaded', syncFab);

  window.AninovelFeedback = { open: open, close: close };
})();
