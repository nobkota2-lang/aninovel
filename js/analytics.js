/* アニノベル 解析・同意バナー
 * 使い方:
 *   <script src="js/analytics.js" defer></script>
 *   ※ 個別ページ側でID設定:
 *     <script>window.ANINOVEL_GA4_ID='G-XXXXXXXXXX';</script>
 *     <script src="js/analytics.js" defer></script>
 *
 * 仕様:
 *   - 初回訪問時に Cookie 同意バナー表示
 *   - 「許可」を押すまで GA4 / Cloudflare Web Analytics は読み込まない (GDPR 準拠)
 *   - 「拒否」を押した場合は永続的に解析を無効化
 *   - localStorage の同意状態は 13ヶ月保存 (Cookie法準拠)
 */
(function(){
  'use strict';
  var CONSENT_KEY='aninovel_analytics_consent_v1';
  var CONSENT_TTL_MS=1000*60*60*24*30*13; // 13ヶ月

  function getConsent(){
    try{
      var raw=localStorage.getItem(CONSENT_KEY);
      if(!raw)return null;
      var d=JSON.parse(raw);
      if(Date.now()-d.at>CONSENT_TTL_MS){localStorage.removeItem(CONSENT_KEY);return null;}
      return d.allow;
    }catch(e){return null;}
  }
  function setConsent(allow){
    try{localStorage.setItem(CONSENT_KEY,JSON.stringify({allow:!!allow,at:Date.now()}));}catch(e){}
  }

  function loadGA4(){
    var id=window.ANINOVEL_GA4_ID;
    if(!id||id.indexOf('G-')!==0)return; // 未設定なら何もしない
    var s=document.createElement('script');
    s.async=true;
    s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(id);
    document.head.appendChild(s);
    window.dataLayer=window.dataLayer||[];
    function gtag(){dataLayer.push(arguments);}
    window.gtag=gtag;
    gtag('js',new Date());
    gtag('config',id,{
      anonymize_ip:true,
      cookie_flags:'SameSite=Lax;Secure',
    });
    console.info('[Analytics] GA4 有効化',id);
  }

  function loadCloudflareAnalytics(){
    var token=window.ANINOVEL_CF_BEACON;
    if(!token)return;
    var s=document.createElement('script');
    s.defer=true;
    s.src='https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon','{"token":"'+token+'"}');
    document.head.appendChild(s);
    console.info('[Analytics] Cloudflare Insights 有効化');
  }

  function activateAll(){
    loadGA4();
    loadCloudflareAnalytics();
  }

  function showBanner(){
    if(document.getElementById('aninovel-consent-banner'))return;
    var bn=document.createElement('div');
    bn.id='aninovel-consent-banner';
    bn.style.cssText='position:fixed;left:16px;right:16px;bottom:16px;max-width:680px;margin:0 auto;background:#2D2A26;color:#FAF6F0;padding:18px 22px;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.4);font-family:"Zen Kaku Gothic New",system-ui,sans-serif;z-index:9999;font-size:14px;line-height:1.6';
    bn.innerHTML=
      '<div style="display:flex;flex-direction:column;gap:14px">'
      +'<div>当サイトはサービス改善のため Cookie および類似技術を使用してアクセス状況を分析しています。詳しくは<a href="/legal/privacy.html" style="color:#FFB39B;text-decoration:underline">プライバシーポリシー</a>をご確認ください。</div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">'
      +'<button id="aninovel-consent-deny"  style="padding:8px 18px;background:transparent;color:#FAF6F0;border:1px solid rgba(255,255,255,.3);border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px">拒否する</button>'
      +'<button id="aninovel-consent-allow" style="padding:8px 18px;background:#C0392B;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600">同意する</button>'
      +'</div></div>';
    document.body.appendChild(bn);
    document.getElementById('aninovel-consent-allow').onclick=function(){
      setConsent(true);bn.remove();activateAll();
    };
    document.getElementById('aninovel-consent-deny').onclick=function(){
      setConsent(false);bn.remove();
    };
  }

  function init(){
    var c=getConsent();
    if(c===true)activateAll();
    else if(c===null) {
      // ページロード後に少し遅延してバナー表示 (LCP に影響しないよう)
      if(document.readyState==='complete')showBanner();
      else window.addEventListener('load',function(){setTimeout(showBanner,800);});
    }
    // c===false の場合は何もしない (拒否継続)
  }

  // 公開: ユーザがフッター等から再度設定変更できるよう
  window.AninovelAnalytics={
    revoke:function(){setConsent(false);location.reload();},
    grant:function(){setConsent(true);location.reload();},
    status:function(){return getConsent();},
    showBanner:showBanner
  };

  init();
})();
