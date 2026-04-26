/* アニノベル 課金・サブスク クライアント
 * バックエンド未稼働時はスタブ動作 (アラートで案内のみ)
 *
 * 本実装には以下が必要:
 *   - Supabase Edge Functions (/create-checkout, /stripe-webhook, /billing-portal)
 *   - Stripe アカウント・Product/Price ID
 *
 * 設定:
 *   window.ANINOVEL_BILLING_API='https://api.aninovel.com'; // Edge Functions ベースURL
 *   window.ANINOVEL_STRIPE_PRICES={
 *     'reader-premium-monthly': 'price_xxx',
 *     'reader-premium-yearly':  'price_yyy',
 *     'author-pro-monthly':     'price_zzz',
 *     'author-pro-yearly':      'price_www'
 *   };
 */
(function(){
  'use strict';
  var API=window.ANINOVEL_BILLING_API||null;
  var PRICES=window.ANINOVEL_STRIPE_PRICES||{};

  function getUser(){try{return JSON.parse(localStorage.getItem('aninovel_user'));}catch(e){return null;}}

  // 現在のサブスク状態 (ローカル参照、本来はサーバ照会)
  function getSubscription(){
    var u=getUser();
    if(!u)return null;
    return u.subscription||null; // 'premium' | 'author_pro' | null
  }

  function isPremium(){return getSubscription()==='premium'||getSubscription()==='author_pro';}

  // チェックアウト開始
  async function startCheckout(planKey){
    var u=getUser();
    if(!u||!u.loggedIn){alert('課金にはログインが必要です。先にアカウントを作成・ログインしてください。');return;}
    if(!API){
      alert('決済システムは現在準備中です。\n\nこの機能は #2+#3 (Supabase Edge Functions) と連携して実装されます。\n\n計画されているプラン:\n・Reader Premium  ¥480/月 (広告非表示)\n・Author Pro     ¥980/月 (投稿無制限+収益還元)');
      return;
    }
    var priceId=PRICES[planKey];
    if(!priceId){alert('不明なプラン: '+planKey);return;}
    try{
      var res=await fetch(API+'/create-checkout',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({priceId:priceId,userId:u.id,userEmail:u.email})
      });
      if(!res.ok)throw new Error('HTTP '+res.status);
      var data=await res.json();
      if(data.url)window.location.href=data.url;
      else throw new Error('checkout URL欠落');
    }catch(e){
      console.error('[Billing] checkout失敗',e);
      alert('決済画面の開始に失敗しました: '+e.message);
    }
  }

  // 顧客ポータル(解約・カード変更)
  async function openCustomerPortal(){
    var u=getUser();
    if(!u||!u.loggedIn){alert('ログインが必要です');return;}
    if(!API){alert('決済システム準備中');return;}
    try{
      var res=await fetch(API+'/billing-portal',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({customerId:u.stripeCustomerId})
      });
      var data=await res.json();
      if(data.url)window.location.href=data.url;
    }catch(e){alert('ポータルを開けませんでした: '+e.message);}
  }

  // 価格テーブル UI
  function openPricingModal(){
    var existing=document.getElementById('aninovel-pricing-modal');if(existing)existing.remove();
    var ov=document.createElement('div');
    ov.id='aninovel-pricing-modal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Zen Kaku Gothic New",system-ui,sans-serif';
    ov.onclick=function(e){if(e.target===ov)ov.remove();};

    var current=getSubscription();

    var bx=document.createElement('div');
    bx.style.cssText='background:#FAF6F0;color:#2D2A26;border-radius:16px;max-width:880px;width:100%;max-height:92vh;overflow-y:auto;padding:36px;box-shadow:0 24px 64px rgba(0,0,0,.4)';
    bx.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><h2 style="font-size:24px;font-weight:700;font-family:\'Noto Serif JP\',serif">プラン</h2><button id="anbill-close" style="border:none;background:transparent;font-size:24px;cursor:pointer">&times;</button></div>'
      +'<p style="color:#6B635A;margin-bottom:24px;font-size:14px">アニノベルをもっと楽しむための有料プランです。いつでも解約できます。</p>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">'
      +planCard('Free','¥0','基本機能、広告あり、月3作品まで投稿',['作品の閲覧・投票','吹き出し表示','音声読み上げ(基本)','しおり機能','作品投稿(月3まで)'],'free',current==='free'||!current,null)
      +planCard('Reader Premium','¥480','/月','読者向け、広告非表示',['Free の全機能','📵 広告非表示','📚 しおり無制限','🎁 優先機能アクセス','💬 優先サポート'],'reader-premium-monthly',current==='premium','#3498DB')
      +planCard('Author Pro','¥980','/月','作者向け、収益還元',['Reader Premium の全機能','📤 投稿数無制限','💰 PV連動の収益還元','📊 詳細な解析ダッシュボード','🎤 高品質音声優先生成','🛡️ 著作権保護優先処理'],'author-pro-monthly',current==='author_pro','#C0392B')
      +'</div>'
      +'<div style="margin-top:20px;padding:14px;background:#FFF4F1;border-radius:8px;font-size:12px;color:#6B635A">📌 年間プラン(2ヶ月分割引)もあります。詳細は決済画面で選択できます。</div>'
      +(current?'<div style="margin-top:16px;text-align:center"><button id="anbill-portal" style="padding:10px 24px;border:1px solid #2D2A26;background:transparent;color:#2D2A26;border-radius:6px;cursor:pointer">サブスク管理 (解約・カード変更)</button></div>':'');
    ov.appendChild(bx);
    document.body.appendChild(ov);

    document.getElementById('anbill-close').onclick=function(){ov.remove();};
    var portal=document.getElementById('anbill-portal');if(portal)portal.onclick=function(){openCustomerPortal();};
    bx.querySelectorAll('[data-anbill-plan]').forEach(function(b){
      b.onclick=function(){var k=b.dataset.anbillPlan;if(k==='free')return;startCheckout(k);};
    });
  }

  function planCard(title,price,sub,desc,features,key,current,accent){
    accent=accent||'#888';
    var btn=current
      ? '<button disabled style="width:100%;padding:12px;background:#10B981;color:#fff;border:none;border-radius:6px;font-weight:600">現在のプラン ✓</button>'
      : (key==='free'
          ? '<button disabled style="width:100%;padding:12px;background:#E2DCD4;color:#888;border:none;border-radius:6px">無料</button>'
          : '<button data-anbill-plan="'+key+'" style="width:100%;padding:12px;background:'+accent+';color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">このプランにする</button>');
    return '<div style="background:#fff;border:2px solid '+(current?accent:'#E2DCD4')+';border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px"><div><h3 style="font-size:18px;font-weight:700;color:'+accent+'">'+title+'</h3><div style="margin-top:6px"><span style="font-size:32px;font-weight:700">'+price+'</span><span style="color:#888;font-size:14px">'+(sub.charAt(0)==='/'?sub:'')+'</span></div><p style="font-size:12px;color:#666;margin-top:4px">'+(sub.charAt(0)==='/'?desc:sub)+'</p></div><ul style="list-style:none;padding:0;margin:0;font-size:13px;line-height:1.9;flex:1">'+features.map(function(f){return '<li>'+f+'</li>';}).join('')+'</ul>'+btn+'</div>';
  }

  window.AninovelBilling={
    startCheckout:startCheckout,
    openCustomerPortal:openCustomerPortal,
    openPricingModal:openPricingModal,
    getSubscription:getSubscription,
    isPremium:isPremium
  };
  console.info('[Billing] 課金モジュール読込完了。AninovelBilling.openPricingModal() で価格表表示。');
})();
