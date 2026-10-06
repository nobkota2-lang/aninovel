/* 広告の表示  js/ads.js
 * ======================================================================
 * 2026-10-05 書き直し。
 * それまでこのファイルは minify された1行だった。開業日のゲートという
 * 事業上の判断がここに入る以上、読めない形で置いておくのは危うい。
 * 中身の挙動は変えていない。足したのは ADS_START のゲートだけ。
 *
 * ----------------------------------------------------------------------
 * 広告を出し始める日
 * ----------------------------------------------------------------------
 * ADS_START より前は、広告のスクリプトを読み込まず、広告枠も描画しない。
 * つまり収益が1円も発生しない。開業日より前に収益が立つことを避けるため。
 *
 * AdSense の審査は、この日より前に受けて構わない。審査中は広告が配信され
 * ないので収益は発生しない。ただし審査時には「サイトに AdSense のコードが
 * あること」が確かめられるので、そのときだけ index.html の <head> に
 * 審査用のタグを静的に置くこと。手順は index.html の該当箇所に書いた。
 *
 * 承認後は、AdSense の管理画面で「自動広告」を必ずオフにすること。
 * 自動広告が入っていると、このファイルのゲートとは無関係に Google が
 * 広告を差し込むので、開業日より前に収益が発生してしまう。
 *
 * 日付を動かすときは、ここ1か所だけ直せばよい。
 */
!function () {
  "use strict";

  // 2027-01-01 00:00 (日本時間)。UTC では前日の15:00。
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
    if (!ins.length) return;   // そもそも枠を出していない (開業日前など)
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
      + '\u{1F4E3} 広告ブロッカーを検出</div>'
      + '当サイトは広告収入で運営されています。<br>'
      + 'もし可能でしたら、ブロッカーのオフをご検討ください。'
      + '広告非表示プラン(月額予定)もあります。'
      + '<div style="text-align:right;margin-top:8px">'
      + '<button onclick="this.closest(\'div\').remove()" '
      + 'style="border:none;background:transparent;color:#666;cursor:pointer;'
      + 'font-size:12px">[閉じる]</button></div>';
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

  window.AninovelAds = {
    isPaidUser: isPaidUser,
    renderAllSlots: renderAllSlots,
    adsStarted: adsStarted,
    startsAt: new Date(ADS_START).toISOString()
  };
}();
