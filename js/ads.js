/* アニノベル 広告モジュール
 * 機能:
 *   - AdSense (or 他社) スニペットの遅延ロード
 *   - 課金ユーザは広告を表示しない
 *   - 同意バナーで「拒否」したユーザにも表示しない
 *   - 広告ブロッカー検知 → 善意の啓発メッセージ
 *   - 広告枠は <div class="aninovel-ad" data-slot="..."> でマーク、自動的に挿入
 *
 * 設定 (各HTMLで):
 *   window.ANINOVEL_ADSENSE_PUBLISHER='ca-pub-XXXXXXXXXXXXXXXX';
 *   window.ANINOVEL_AD_SLOTS={ inline:'0000000000', sidebar:'1111111111' };
 *
 * 広告ポリシー(設計):
 *   - 作品本文中央への割込みはしない (UX重視)
 *   - 作品の最後・ホームのフッター・モーダル下部などに限定
 *   - 1ページ最大2枠
 */
(function(){
  'use strict';

  function isPaidUser(){
    try{
      var u=JSON.parse(localStorage.getItem('aninovel_user'));
      if(!u||!u.loggedIn)return false;
      // Phase B 以降は Supabase profiles.subscription を参照
      return !!(u.subscription&&(u.subscription==='premium'||u.subscription==='author_pro'));
    }catch(e){return false;}
  }

  function hasConsent(){
    try{var c=JSON.parse(localStorage.getItem('aninovel_analytics_consent_v1'));return !!(c&&c.allow);}catch(e){return false;}
  }

  function getPublisher(){return window.ANINOVEL_ADSENSE_PUBLISHER||null;}
  function getSlot(name){return (window.ANINOVEL_AD_SLOTS||{})[name]||null;}

  function loadAdSenseScript(){
    if(window._adsenseLoaded)return;
    var pub=getPublisher();if(!pub||!pub.indexOf||pub.indexOf('ca-pub-')!==0)return;
    var s=document.createElement('script');
    s.async=true;
    s.crossOrigin='anonymous';
    s.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+encodeURIComponent(pub);
    document.head.appendChild(s);
    window._adsenseLoaded=true;
    console.info('[Ads] AdSense ロード',pub);
  }

  function renderAdSlot(el){
    var pub=getPublisher();
    var slotName=el.dataset.slot||'inline';
    var slotId=getSlot(slotName);
    var fmt=el.dataset.format||'auto';
    if(!pub||!slotId){
      // 開発時はプレースホルダ表示
      el.innerHTML='<div style="background:repeating-linear-gradient(45deg,#F5EFE6,#F5EFE6 8px,#FFF 8px,#FFF 16px);border:1px dashed #C0C0C0;border-radius:8px;padding:24px;text-align:center;color:#999;font-size:12px;font-family:system-ui">📢 広告枠 (slot='+slotName+'); ID未設定</div>';
      return;
    }
    el.innerHTML='<ins class="adsbygoogle" style="display:block" data-ad-client="'+pub+'" data-ad-slot="'+slotId+'" data-ad-format="'+fmt+'" data-full-width-responsive="true"></ins>';
    try{(window.adsbygoogle=window.adsbygoogle||[]).push({});}catch(e){console.warn('[Ads] push失敗',e);}
  }

  function renderAllSlots(){
    var els=document.querySelectorAll('.aninovel-ad:not([data-rendered])');
    els.forEach(function(el){
      el.setAttribute('data-rendered','1');
      renderAdSlot(el);
    });
  }

  // 広告ブロッカー検知 (簡易): 広告ロード後10秒で非表示判定
  function detectBlocker(){
    setTimeout(function(){
      var els=document.querySelectorAll('.aninovel-ad ins.adsbygoogle');
      if(!els.length)return;
      var blocked=Array.prototype.every.call(els,function(el){
        var r=el.getBoundingClientRect();
        return r.height<10;
      });
      if(blocked){
        console.info('[Ads] 広告ブロッカーを検知。啓発メッセージを表示します。');
        var hint=document.createElement('div');
        hint.style.cssText='position:fixed;bottom:88px;right:16px;max-width:320px;background:#FFF4F1;border:1px solid #C0392B;border-radius:8px;padding:14px;font-size:13px;color:#2D2A26;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:9000;line-height:1.6;font-family:system-ui';
        hint.innerHTML='<div style="font-weight:700;color:#C0392B;margin-bottom:6px">📣 広告ブロッカーを検出</div>当サイトは広告収入で運営されています。<br>もし可能でしたら、ブロッカーのオフをご検討ください。広告非表示プラン(月額予定)もあります。<br><div style="text-align:right;margin-top:8px"><button onclick="this.closest(\'div\').remove()" style="border:none;background:transparent;color:#666;cursor:pointer;font-size:12px">[閉じる]</button></div>';
        document.body.appendChild(hint);
      }
    },10000);
  }

  function init(){
    if(isPaidUser()){console.info('[Ads] 課金ユーザ。広告非表示。');document.documentElement.classList.add('aninovel-noads');return;}
    if(!hasConsent()){console.info('[Ads] 解析未同意のため広告も非表示。');return;}
    loadAdSenseScript();
    // ロード後にレンダ
    setTimeout(renderAllSlots,500);
    // SPA的に動的追加された広告枠の監視
    var mo=new MutationObserver(function(){renderAllSlots();});
    mo.observe(document.body,{childList:true,subtree:true});
    detectBlocker();
  }

  // CSS: 課金ユーザは aninovel-ad を非表示
  var style=document.createElement('style');
  style.textContent='.aninovel-noads .aninovel-ad{display:none!important}';
  document.head.appendChild(style);

  if(document.readyState==='complete'||document.readyState==='interactive')init();
  else document.addEventListener('DOMContentLoaded',init);

  window.AninovelAds={
    isPaidUser:isPaidUser,
    renderAllSlots:renderAllSlots
  };
})();
