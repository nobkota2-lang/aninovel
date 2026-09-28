/* アニノベル 課金・サブスク クライアント  js/billing.js
 * ------------------------------------------------------------
 * 2026-09-27 改訂: 料金モデルを事業計画どおりに書き換えた。
 *
 *   立ち読み (登録なし) … 無料。1日5作品まで
 *   読者会員            … キャンペーン期間中は無料
 *                          終了後の新規登録、および終了から3カ月経過で
 *                          月額330円 (税込)
 *   作者会員            … キャンペーン期間中は無料
 *                          作品の登録・編集を続けている間は終了後も無料
 *                          3カ月間 登録・編集がない場合は読者会員と同額
 *
 *   キャンペーンの終了時期は表に出さない。「キャンペーン終了後」とだけ書く。
 *   販売するのは「作品を読むための権利」だけ。著作権・版権は売らない。
 *
 * 決済 (Stripe) は第4段でまだ繋いでいない。この画面はいま
 * 「登録するだけ・お支払いなし」で完結する。startCheckout と
 * openCustomerPortal は第4段のために残してあるが、ボタンからは呼ばない。
 *
 * 設定 (第4段で使う):
 *   window.ANINOVEL_BILLING_API='https://api.aninovel.com';
 *   window.ANINOVEL_STRIPE_PRICES={'member-monthly':'price_xxx'};
 */
(function(){
  'use strict';

  var API=window.ANINOVEL_BILLING_API||null;
  var PRICES=window.ANINOVEL_STRIPE_PRICES||{};

  /* ---------- 料金のことば (1か所にまとめる) ---------- */
  var PRICE_YEN   = 330;               // 税込
  var PRICE_LABEL = '月額330円 (税込)';
  var CAMPAIGN    = true;              // キャンペーン期間中か
  var PEEK_LIMIT  = 5;                 // 立ち読みの1日あたり作品数

  /* ---------- 利用者 ---------- */
  function getUser(){
    try{
      var u=JSON.parse(localStorage.getItem('aninovel_user'));
      return (u&&u.loggedIn&&u._server)?u:null;   // サーバーで確認できた人だけ
    }catch(e){return null;}
  }
  function hasRole(u,r){
    try{return !!(u&&u.roles&&u.roles.indexOf(r)>=0);}catch(e){return false;}
  }
  function getSubscription(){
    var u=getUser();
    return (u&&u.subscription)||null;   // 第4段で 'member' などが入る
  }
  function isPremium(){
    // キャンペーン中は登録会員すべてが広告以外の制限なしで読める
    return !!getUser();
  }

  /* ---------- 第4段のための土台 (いまボタンからは呼ばない) ---------- */
  async function startCheckout(planKey){
    var u=getUser();
    if(!u){alert('お支払いの手続きにはログインが必要です。');return;}
    if(!API){
      alert('いまはキャンペーン期間中のため、お支払いはありません。\n無料でお使いいただけます。');
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

  async function openCustomerPortal(){
    var u=getUser();
    if(!u){alert('ログインが必要です');return;}
    if(!API){alert('いまはキャンペーン期間中のため、お支払いの管理画面はありません。');return;}
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

  /* ---------- 料金表 ---------- */

  function esc(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function card(o){
    var accent=o.accent||'#6B635A';
    var border=o.you?accent:'#E2DCD4';
    var priceHTML=o.strike
      ? '<span style="font-size:15px;color:#A39A8F;text-decoration:line-through;margin-right:8px">'+esc(o.strike)+'</span>'
        +'<span style="font-size:30px;font-weight:700;color:'+accent+'">'+esc(o.price)+'</span>'
      : '<span style="font-size:30px;font-weight:700;color:'+accent+'">'+esc(o.price)+'</span>';

    return '<div style="background:#fff;border:2px solid '+border+';border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px">'
      +(o.you?'<div style="align-self:flex-start;background:'+accent+';color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px">いまのあなた</div>':'')
      +'<div>'
        +'<h3 style="font-size:17px;font-weight:700;color:'+accent+';margin:0">'+esc(o.title)+'</h3>'
        +'<div style="margin-top:6px">'+priceHTML+'</div>'
        +'<p style="font-size:12px;color:#6B635A;margin:4px 0 0;line-height:1.6">'+esc(o.lead)+'</p>'
      +'</div>'
      +'<ul style="list-style:none;padding:0;margin:0;font-size:13px;line-height:1.9;flex:1">'
        +o.features.map(function(f){return '<li>'+esc(f)+'</li>';}).join('')
      +'</ul>'
      +(o.note?'<p style="font-size:11px;color:#8A8078;line-height:1.7;margin:0;padding-top:10px;border-top:1px dashed #E2DCD4">'+esc(o.note)+'</p>':'')
      +(o.action||'')
      +'</div>';
  }

  function actionBtn(label,accent,href){
    return '<a href="'+esc(href)+'" style="display:block;text-align:center;padding:11px;background:'+accent
      +';color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">'+esc(label)+'</a>';
  }
  function actionFlat(label){
    return '<div style="text-align:center;padding:11px;background:#EFEAE3;color:#8A8078;border-radius:6px;font-size:13px">'
      +esc(label)+'</div>';
  }

  function openPricingModal(){
    var existing=document.getElementById('aninovel-pricing-modal');
    if(existing)existing.remove();

    var u       = getUser();
    var isAuthor= hasRole(u,'author')||hasRole(u,'owner');
    var isReader= !!u && !isAuthor;
    var guest   = !u;

    var ov=document.createElement('div');
    ov.id='aninovel-pricing-modal';
    ov.setAttribute('role','dialog');
    ov.setAttribute('aria-modal','true');
    ov.setAttribute('aria-label','プラン');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;'
      +'align-items:center;justify-content:center;padding:16px;'
      +'font-family:"Zen Kaku Gothic New",system-ui,sans-serif';
    ov.onclick=function(e){if(e.target===ov)close();};

    var bx=document.createElement('div');
    bx.style.cssText='background:#FAF6F0;color:#2D2A26;border-radius:16px;max-width:920px;width:100%;'
      +'max-height:92vh;overflow-y:auto;padding:32px;box-shadow:0 24px 64px rgba(0,0,0,.4)';

    var cards=''
      + card({
          title:'立ち読み',
          price:'¥0',
          lead:'登録なしで、そのまま読めます。',
          you:guest,
          accent:'#6B635A',
          features:[
            '1日'+PEEK_LIMIT+'作品まで読めます',
            'ログインは不要',
            'しおりはこの端末にだけ残ります',
            '広告が表示されます'
          ],
          note:'もっと読みたくなったら、無料の読者会員にご登録ください。',
          action: guest ? actionBtn('無料で読者会員になる','#0E7490','register.html') : actionFlat('ご登録ありがとうございます')
        })
      + card({
          title:'読者会員',
          price: CAMPAIGN ? '¥0' : PRICE_YEN.toLocaleString('ja-JP')+'円/月',
          strike: CAMPAIGN ? PRICE_YEN.toLocaleString('ja-JP')+'円/月' : null,
          lead: CAMPAIGN ? 'キャンペーン期間中につき無料。' : PRICE_LABEL+'。いつでも解約できます。',
          you:isReader,
          accent:'#0E7490',
          features:[
            '作品数の制限なく読み放題',
            'しおりがどの端末でも同じ場所から',
            '読み方の設定 (色・アイコン・音声) を保存',
            '投票・お気に入り',
            '広告が表示されます'
          ],
          note:'キャンペーン終了後にご登録の方、および終了から3カ月を過ぎてお使いの方には '
              +PRICE_LABEL+' をお願いします。',
          action: guest ? actionBtn('無料で登録する','#0E7490','register.html')
                        : (isReader?actionFlat('ご利用中 ✓'):actionFlat('作者会員に含まれます'))
        })
      + card({
          title:'作者会員',
          price: CAMPAIGN ? '¥0' : '条件により¥0',
          strike: null,
          lead: CAMPAIGN ? 'キャンペーン期間中につき無料。読者会員の機能もすべて含みます。'
                         : '作品を書き続けている間は無料です。',
          you:isAuthor,
          accent:'#C0392B',
          features:[
            '読者会員のすべての機能',
            '作品を投稿できます (公開はオーナーの審査後)',
            '読まれた分だけ収益分配のポイントが貯まります',
            '登場人物・声・色を自分で設定できます'
          ],
          note:'作品の登録・編集を続けている作者は、キャンペーン終了後も無料です。'
              +'3カ月間 登録・編集がない場合は、読者会員と同じ '+PRICE_LABEL+' をお願いします。',
          action: guest ? actionBtn('作者として登録する','#C0392B','register.html')
                        : (isAuthor?actionFlat('ご利用中 ✓'):actionBtn('作者になる','#C0392B','register.html'))
        });

    bx.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px">'
        +'<h2 style="font-size:23px;font-weight:700;font-family:\'Noto Serif JP\',serif;margin:0">プラン</h2>'
        +'<button id="anbill-close" aria-label="閉じる" style="border:none;background:transparent;'
          +'font-size:26px;line-height:1;cursor:pointer;color:#6B635A">&times;</button>'
      +'</div>'

      +(CAMPAIGN
        ? '<div style="background:linear-gradient(135deg,#FFF7E6,#FFEFD6);border:1px solid #F0C879;'
            +'border-radius:10px;padding:14px 16px;margin-bottom:20px">'
            +'<div style="font-weight:700;font-size:15px;color:#8A5A00">🎉 いまはキャンペーン期間中につき、すべて無料です</div>'
            +'<p style="font-size:12.5px;color:#7A6A50;margin:6px 0 0;line-height:1.75">'
              +'キャンペーン終了後も3カ月は無料のままです。'
              +'お支払いの手続きは、いまはありません。'
            +'</p>'
          +'</div>'
        : '')

      +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px">'
        +cards
      +'</div>'

      +'<div style="margin-top:20px;padding:14px 16px;background:#F3EFE8;border-radius:8px;'
        +'font-size:12px;color:#6B635A;line-height:1.85">'
        +'<div>📌 有料になるのは「作品を読むための権利」です。'
          +'作品の著作権・版権を譲渡したり販売したりすることはありません。'
          +'素材や道具の販売もしません。</div>'
        +'<div style="margin-top:6px">📌 作者の収益は、読まれた量に応じたポイントで分配します。'
          +'算定方法は<a href="legal/terms.html" style="color:#0E7490">利用規約</a>に記載します。</div>'
      +'</div>';

    ov.appendChild(bx);
    document.body.appendChild(ov);

    var prevFocus=document.activeElement;
    function close(){
      document.removeEventListener('keydown',onKey);
      ov.remove();
      try{if(prevFocus&&prevFocus.focus)prevFocus.focus();}catch(e){}
    }
    function onKey(e){if(e.key==='Escape')close();}
    document.addEventListener('keydown',onKey);

    var btn=document.getElementById('anbill-close');
    if(btn){btn.onclick=close;btn.focus();}
  }

  window.AninovelBilling={
    startCheckout:startCheckout,
    openCustomerPortal:openCustomerPortal,
    openPricingModal:openPricingModal,
    getSubscription:getSubscription,
    isPremium:isPremium,
    priceYen:PRICE_YEN,
    campaign:CAMPAIGN,
    peekLimit:PEEK_LIMIT
  };

  console.info('[Billing] 料金モジュール読込完了 (キャンペーン'+(CAMPAIGN?'中':'終了')+')。'
    +'AninovelBilling.openPricingModal() で料金表。');
})();
