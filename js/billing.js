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
  var PRICE_LABEL_EN = '¥330 per month (incl. tax)';

  /* ---------- 言語 ----------
     料金表は開くたびに組み立て直す。値段や日数を混ぜた文は固定の対応表に
     載らないので、i18n.js の文字列置換では追えない。描画するその場で
     言語を見て選ぶ。読む鍵はポータルと同じ。 */
  function _lang(){
    try{
      var v=localStorage.getItem('aninovel_lang_v1')||localStorage.getItem('aninovel_lang')||'ja';
      return v==='en'?'en':'ja';
    }catch(e){ return 'ja'; }
  }
  function _t(ja,en){ return _lang()==='en' ? en : ja; }
  function _price(){
    return _lang()==='en' ? '¥'+PRICE_YEN.toLocaleString('en-US')+'/month'
                          : PRICE_YEN.toLocaleString('ja-JP')+'円/月';
  }
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
    if(!u){alert(_t('お支払いの手続きにはログインが必要です。','You need to sign in before setting up payment.'));return;}
    if(!API){
      alert(_t('いまはキャンペーン期間中のため、お支払いはありません。\n無料でお使いいただけます。','There is nothing to pay during the campaign.\nAniNovel is free to use.'));
      return;
    }
    var priceId=PRICES[planKey];
    if(!priceId){alert(_t('不明なプラン: ','Unknown plan: ')+planKey);return;}
    try{
      var res=await fetch(API+'/create-checkout',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({priceId:priceId,userId:u.id,userEmail:u.email})
      });
      if(!res.ok)throw new Error('HTTP '+res.status);
      var data=await res.json();
      if(data.url)window.location.href=data.url;
      else throw new Error(_t('決済URLが返りませんでした','no checkout URL returned'));
    }catch(e){
      console.error('[Billing] checkout失敗',e);
      alert(_t('決済画面の開始に失敗しました: ','Could not open the checkout page: ')+e.message);
    }
  }

  async function openCustomerPortal(){
    var u=getUser();
    if(!u){alert(_t('ログインが必要です','Please sign in.'));return;}
    if(!API){alert(_t('いまはキャンペーン期間中のため、お支払いの管理画面はありません。','There is no billing portal during the campaign.'));return;}
    try{
      var res=await fetch(API+'/billing-portal',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({customerId:u.stripeCustomerId})
      });
      var data=await res.json();
      if(data.url)window.location.href=data.url;
    }catch(e){alert(_t('ポータルを開けませんでした: ','Could not open the billing portal: ')+e.message);}
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
      +(o.you?'<div style="align-self:flex-start;background:'+accent+';color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px">'+_t('いまのあなた','Your plan')+'</div>':'')
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
    ov.setAttribute('aria-label',_t('プラン','Plans'));
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;'
      +'align-items:center;justify-content:center;padding:16px;'
      +'font-family:"Zen Kaku Gothic New",system-ui,sans-serif';
    ov.onclick=function(e){if(e.target===ov)close();};

    var bx=document.createElement('div');
    bx.style.cssText='background:#FAF6F0;color:#2D2A26;border-radius:16px;max-width:920px;width:100%;'
      +'max-height:92vh;overflow-y:auto;padding:32px;box-shadow:0 24px 64px rgba(0,0,0,.4)';

    var cards=''
      + card({
          title:_t('立ち読み','Browsing'),
          price:'¥0',
          lead:_t('登録なしで、そのまま読めます。','Start reading right away — no account needed.'),
          you:guest,
          accent:'#6B635A',
          features:[
            _t('1日'+PEEK_LIMIT+'作品まで読めます','Up to '+PEEK_LIMIT+' works a day'),
            _t('ログインは不要','No sign-in required'),
            _t('しおりはこの端末にだけ残ります','Bookmarks stay on this device only'),
            _t('広告が表示されます','Ads are shown')
          ],
          note:_t('もっと読みたくなったら、無料の読者会員にご登録ください。','Want to read more? Sign up as a reader — it is free.'),
          action: guest ? actionBtn(_t('無料で読者会員になる','Become a reader — free'),'#0E7490','register.html')
                        : actionFlat(_t('ご登録ありがとうございます','Thank you for registering'))
        })
      + card({
          title:_t('読者会員','Reader'),
          price: CAMPAIGN ? '¥0' : _price(),
          strike: CAMPAIGN ? _price() : null,
          lead: CAMPAIGN ? _t('キャンペーン期間中につき無料。','Free during the campaign.')
                         : _t(PRICE_LABEL+'。いつでも解約できます。', PRICE_LABEL_EN+'. Cancel any time.'),
          you:isReader,
          accent:'#0E7490',
          features:[
            _t('作品数の制限なく読み放題','Unlimited reading — no cap on works'),
            _t('しおりがどの端末でも同じ場所から','Bookmarks follow you across devices'),
            _t('読み方の設定 (色・アイコン・音声) を保存','Your reading settings (colours, icons, voices) are saved'),
            _t('投票・お気に入り','Voting and favourites'),
            _t('広告が表示されます','Ads are shown')
          ],
          note:_t('キャンペーン終了後にご登録の方、および終了から3カ月を過ぎてお使いの方には '+PRICE_LABEL+' をお願いします。',
                  'If you sign up after the campaign ends, or keep using AniNovel more than three months after it ends, the fee is '+PRICE_LABEL_EN+'.'),
          action: guest ? actionBtn(_t('無料で登録する','Sign up free'),'#0E7490','register.html')
                        : (isReader?actionFlat(_t('ご利用中 ✓','Your current plan ✓'))
                                   :actionFlat(_t('作者会員に含まれます','Included with the Author plan')))
        })
      + card({
          title:_t('作者会員','Author'),
          price: CAMPAIGN ? '¥0' : _t('条件により¥0','¥0 if active'),
          strike: null,
          lead: CAMPAIGN ? _t('キャンペーン期間中につき無料。読者会員の機能もすべて含みます。','Free during the campaign. Includes everything in the Reader plan.')
                         : _t('作品を書き続けている間は無料です。','Free for as long as you keep writing.'),
          you:isAuthor,
          accent:'#C0392B',
          features:[
            _t('読者会員のすべての機能','Everything in the Reader plan'),
            _t('作品を投稿できます (公開はオーナーの審査後)','Publish your works (after review by the operator)'),
            _t('読まれた分だけ収益分配のポイントが貯まります','Earn revenue-share points for how much your work is read'),
            _t('登場人物・声・色を自分で設定できます','Set your own characters, voices and colours')
          ],
          note:_t('作品の登録・編集を続けている作者は、キャンペーン終了後も無料です。3カ月間 登録・編集がない場合は、読者会員と同じ '+PRICE_LABEL+' をお願いします。',
                  'Authors who keep adding or editing works stay free after the campaign ends. After three months with no activity, the fee is the same as the Reader plan: '+PRICE_LABEL_EN+'.'),
          action: guest ? actionBtn(_t('作者として登録する','Sign up as an author'),'#C0392B','register.html')
                        : (isAuthor?actionFlat(_t('ご利用中 ✓','Your current plan ✓'))
                                   :actionBtn(_t('作者になる','Become an author'),'#C0392B','register.html'))
        });

    bx.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px">'
        +'<h2 style="font-size:23px;font-weight:700;font-family:\'Noto Serif JP\',serif;margin:0">'+_t('プラン','Plans')+'</h2>'
        +'<button id="anbill-close" aria-label="'+_t('閉じる','Close')+'" style="border:none;background:transparent;'
          +'font-size:26px;line-height:1;cursor:pointer;color:#6B635A">&times;</button>'
      +'</div>'

      +(CAMPAIGN
        ? '<div style="background:linear-gradient(135deg,#FFF7E6,#FFEFD6);border:1px solid #F0C879;'
            +'border-radius:10px;padding:14px 16px;margin-bottom:20px">'
            +'<div style="font-weight:700;font-size:15px;color:#8A5A00">'+_t('🎉 いまはキャンペーン期間中につき、すべて無料です','🎉 Everything is free during the campaign')+'</div>'
            +'<p style="font-size:12.5px;color:#7A6A50;margin:6px 0 0;line-height:1.75">'
              +_t('キャンペーン終了後も3カ月は無料のままです。お支払いの手続きは、いまはありません。',
                   'It stays free for three months after the campaign ends. There is nothing to set up now.')
            +'</p>'
          +'</div>'
        : '')

      +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px">'
        +cards
      +'</div>'

      +'<div style="margin-top:20px;padding:14px 16px;background:#F3EFE8;border-radius:8px;'
        +'font-size:12px;color:#6B635A;line-height:1.85">'
        +'<div>'+_t('📌 有料になるのは「作品を読むための権利」です。作品の著作権・版権を譲渡したり販売したりすることはありません。素材や道具の販売もしません。',
                     '📌 What you pay for is the right to read. We never transfer or sell the copyright in a work, and we do not sell assets or tools.')+'</div>'
        +'<div style="margin-top:6px">'
          +_t('📌 作者の収益は、読まれた量に応じたポイントで分配します。算定方法は','📌 Author earnings are shared as points based on how much their work is read. The calculation is set out in the ')
          +'<a href="/legal/terms.html" style="color:#0E7490">'+_t('利用規約','Terms of Service')+'</a>'
          +_t('に記載します。','.')+'</div>'
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
