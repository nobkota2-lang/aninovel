/* 法的文書ページの言語切り替え  legal/_legal-i18n.js
 * ============================================================
 *
 * なぜ日本語と英語を1ページに両方入れているのか
 *   法律の条文は、訳すときに1文字ずれただけで意味が変わる。
 *   日本語の条文に手を入れずに済むよう、原文はそのまま残し、
 *   英語は別の <main> として並べて置き、どちらかだけを見せる。
 *   URL も1つのままなので、規約に貼られた既存のリンクが切れない。
 *
 * どちらを見せるか
 *   ポータルと同じ鍵（aninovel_lang_v1）を読む。サイト全体で
 *   言語の選択が揃うようにするため、ここで独自の記憶は持たない。
 *
 * 英語は参考訳
 *   英語側の先頭に、日本語が正本である旨の一文を入れてある。
 *   利用規約と特商法表記は日本法に基づく文書なので、この断りは外さない。
 */
(function () {
  'use strict';

  var KEY = 'aninovel_lang_v1';
  var ALT = 'aninovel_lang';

  // ヘッダーとフッターは全ページ共通の短い語だけなので、ここで持つ
  var NAV = {
    'アニノベル': 'AniNovel',
    '利用規約': 'Terms of Service',
    '収益分配': 'Revenue Share',
    'プライバシー': 'Privacy',
    'プライバシーポリシー': 'Privacy Policy',
    '特商法': 'Commercial Disclosure',
    '特商法表記': 'Commercial Disclosure',
    '著作権窓口': 'Copyright Contact',
    'アクセシビリティ': 'Accessibility',
    'トップに戻る': 'Back to top'
  };

  var TITLE = {
    'terms': 'Terms of Service | AniNovel',
    'revenue': 'Revenue Share and How Points Are Calculated | AniNovel',
    'privacy': 'Privacy Policy | AniNovel',
    'tokushoho': 'Commercial Disclosure | AniNovel',
    'dmca': 'Copyright Contact | AniNovel',
    'accessibility': 'Accessibility Statement | AniNovel'
  };

  function lang() {
    try {
      var v = localStorage.getItem(KEY) || localStorage.getItem(ALT) || 'ja';
      return v === 'en' ? 'en' : 'ja';
    } catch (e) { return 'ja'; }
  }

  function setLang(v) {
    try { localStorage.setItem(KEY, v); localStorage.setItem(ALT, v); } catch (e) {}
    apply();
  }

  function apply() {
    var en = lang() === 'en';
    document.documentElement.lang = en ? 'en' : 'ja';

    // 本文: 片方だけを見せる
    var mains = document.querySelectorAll('main[data-lang]');
    for (var i = 0; i < mains.length; i++) {
      var want = mains[i].getAttribute('data-lang') === (en ? 'en' : 'ja');
      mains[i].hidden = !want;
      // id は見えている側だけが持つ。スキップリンクの飛び先がぶれないように。
      if (want) mains[i].id = 'main'; else mains[i].removeAttribute('id');
    }

    // ヘッダーとフッターの短い語
    var links = document.querySelectorAll('.legal-header a, .legal-footer a, .legal-header .logo');
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      if (!a.hasAttribute('data-ja')) a.setAttribute('data-ja', a.textContent.trim());
      var ja = a.getAttribute('data-ja');
      a.textContent = (en && NAV[ja]) ? NAV[ja] : ja;
    }

    // フッターの «© 2026 アニノベル»
    var ft = document.querySelector('.legal-footer');
    if (ft) {
      for (var k = 0; k < ft.childNodes.length; k++) {
        var n = ft.childNodes[k];
        if (n.nodeType !== 3) continue;
        var t = n.nodeValue;
        if (en && t.indexOf('アニノベル') >= 0) n.nodeValue = t.replace('アニノベル', 'AniNovel');
        else if (!en && t.indexOf('AniNovel') >= 0) n.nodeValue = t.replace('AniNovel', 'アニノベル');
      }
    }

    // ページの題
    var slug = (location.pathname.split('/').pop() || '').replace('.html', '');
    if (en && TITLE[slug]) {
      if (!document.body.getAttribute('data-title-ja')) {
        document.body.setAttribute('data-title-ja', document.title);
      }
      document.title = TITLE[slug];
    } else if (!en && document.body.getAttribute('data-title-ja')) {
      document.title = document.body.getAttribute('data-title-ja');
    }

    var btn = document.getElementById('legal-lang-btn');
    if (btn) {
      btn.textContent = en ? '日本語' : 'English';
      btn.setAttribute('aria-label', en ? '日本語に切り替える' : 'Switch to English');
    }
  }

  function mountButton() {
    var host = document.querySelector('.legal-header');
    if (!host || document.getElementById('legal-lang-btn')) return;
    var b = document.createElement('button');
    b.id = 'legal-lang-btn';
    b.type = 'button';
    b.className = 'legal-lang-btn';
    b.onclick = function () { setLang(lang() === 'en' ? 'ja' : 'en'); };
    host.appendChild(b);
  }

  function init() { mountButton(); apply(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // 別のタブで言語を変えたときも揃える
  window.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === ALT) apply();
  });

  window.AninovelLegalI18n = { apply: apply, setLang: setLang, lang: lang };
})();
