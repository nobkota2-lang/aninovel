/* 広告の表示  js/ads.js
 * ======================================================================
 * ADS_START より前は、広告のスクリプトを読み込まず、広告枠も描画しない。
 *
 * 有効化の条件・時期・その判断の経緯は、**ここには書かない**。
 * このファイルは aninovel.com から誰でも読める。控えは公開しない手元の
 * メモに置くこと。
 *
 * 日付を動かすときは ADS_START の1か所だけ直せばよい。
 */
!function () {
  "use strict";

  /* 言語。ポータル(aninovel_lang_v1)とビューア(aninovel_lang)の両方を見る。
     share.js と同じ形。日本語の書体が入っていないパソコンでは、
     英語モードに残った日本語は豆腐(□)になるので、元で出し分ける。 */
  function _lang(){
    try{
      var v=localStorage.getItem('aninovel_lang_v1')||localStorage.getItem('aninovel_lang')||'ja';
      return v==='en'?'en':'ja';
    }catch(e){ return 'ja'; }
  }
  function _t(ja,en){ return _lang()==='en' ? en : ja; }



  var ADS_START = Date.UTC(2026, 11, 31, 15, 0, 0);

  /** 広告を出してよい日になったか */
  function adsStarted() {
    // 手元で確かめるときは window.ANINOVEL_ADS_START に別の日時を入れる
    var t = (typeof window.ANINOVEL_ADS_START === 'number')
      ? window.ANINOVEL_ADS_START : ADS_START;
    return Date.now() >= t;
  }

  /** 有料会員か (広告を出さない) */
  function isPaidUser() {
    try {
      var u = JSON.parse(localStorage.getItem("aninovel_user"));
      if (!u || !u.loggedIn || !u.subscription) return false;
      return u.subscription === "premium" || u.subscription === "author_pro";
    } catch (e) { return false; }
  }

  /** 解析への同意があるか */
  function hasConsent() {
    try {
      var c = JSON.parse(localStorage.getItem("aninovel_analytics_consent_v1"));
      return !!(c && c.allow);
    } catch (e) { return false; }
  }

  function publisherId() {
    return window.ANINOVEL_ADSENSE_PUBLISHER || null;
  }

  function slotId(name) {
    return (window.ANINOVEL_AD_SLOTS || {})[name] || null;
  }

  /** 広告枠ひとつを描画する。出せないときは枠ごと畳む。 */
  function renderSlot(el) {
    var pub = publisherId();
    var name = el.dataset.slot || "inline";
    var id = slotId(name);
    var format = el.dataset.format || "auto";

    // 日付前・ID未設定・枠ID未設定のいずれでも、何も出さずに畳む。
    // 畳まないと、訪問者に空の点線枠が見えてしまう。
    if (!adsStarted() || !pub || !id) { el.style.display = "none"; return; }

    el.innerHTML = '<ins class="adsbygoogle" style="display:block"'
      + ' data-ad-client="' + pub + '"'
      + ' data-ad-slot="' + id + '"'
      + ' data-ad-format="' + format + '"'
      + ' data-full-width-responsive="true"></ins>';
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      console.warn("[Ads] push失敗", e);
    }
  }

  function renderAllSlots() {
    document.querySelectorAll(".aninovel-ad:not([data-rendered])")
      .forEach(function (el) {
        el.setAttribute("data-rendered", "1");
        renderSlot(el);
      });
  }

  function loadAdSense() {
    if (window._adsenseLoaded) return;
    var pub = publisherId();
    if (!pub || !pub.indexOf || pub.indexOf("ca-pub-") !== 0) return;
    var s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client="
          + encodeURIComponent(pub);
    document.head.appendChild(s);
    window._adsenseLoaded = true;
    console.info("[Ads] AdSense ロード", pub);
  }

  /** 広告ブロッカーの検知。枠はあるのに高さが出ないときだけ出す。 */
  function warnIfBlocked() {
    var ins = document.querySelectorAll(".aninovel-ad ins.adsbygoogle");
    if (!ins.length) return;   // そもそも枠を出していない
    var allFlat = Array.prototype.every.call(ins, function (e) {
      return e.getBoundingClientRect().height < 10;
    });
    if (!allFlat) return;

    console.info("[Ads] 広告ブロッカーを検知。啓発メッセージを表示します。");
    var box = document.createElement("div");
    box.style.cssText = "position:fixed;bottom:88px;right:16px;max-width:320px;"
      + "background:#FFF4F1;border:1px solid #C0392B;border-radius:8px;padding:14px;"
      + "font-size:13px;color:#2D2A26;box-shadow:0 8px 24px rgba(0,0,0,.15);"
      + "z-index:9000;line-height:1.6;font-family:system-ui";
    box.innerHTML = '<div style="font-weight:700;color:#C0392B;margin-bottom:6px">'
      + _t('\u{1F4E3} 広告ブロッカーを検出','\u{1F4E3} An ad blocker is on')+'</div>'
      + _t('当サイトは広告収入で運営されています。<br>','This site is paid for by its adverts.<br>')
      + _t('もし可能でしたら、ブロッカーのオフをご検討ください。','If you can, please consider turning the blocker off.')
      + _t('広告非表示プラン(月額予定)もあります。','There is also a plan without adverts.')
      + '<div style="text-align:right;margin-top:8px">'
      + '<button onclick="this.closest(\'div\').remove()" '
      + 'style="border:none;background:transparent;color:#666;cursor:pointer;'
      + 'font-size:12px">'+_t('[閉じる]','[Close]')+'</button></div>';
    document.body.appendChild(box);
  }

  function init() {
    if (isPaidUser()) {
      console.info("[Ads] 課金ユーザ。広告非表示。");
      document.documentElement.classList.add("aninovel-noads");
      return;
    }
    if (!hasConsent()) {
      console.info("[Ads] 解析未同意のため広告も非表示。");
      return;
    }
    if (!adsStarted()) {
      // 枠は畳むが、MutationObserver は回す。後から足される枠も畳むため。
      console.info("[Ads] 広告の開始日前のため非表示。");
      renderAllSlots();
      new MutationObserver(renderAllSlots)
        .observe(document.body, { childList: true, subtree: true });
      return;
    }

    loadAdSense();
    setTimeout(renderAllSlots, 500);
    new MutationObserver(renderAllSlots)
      .observe(document.body, { childList: true, subtree: true });
    setTimeout(warnIfBlocked, 10000);
  }

  var style = document.createElement("style");
  style.textContent = ".aninovel-noads .aninovel-ad{display:none!important}";
  document.head.appendChild(style);

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }

  // startsAt は公開しない。誰でもコンソールから日付を読めてしまう。
  // 状態だけ分かれば運用には足りる。
  window.AninovelAds = {
    isPaidUser: isPaidUser,
    renderAllSlots: renderAllSlots,
    adsStarted: adsStarted
  };
}();
