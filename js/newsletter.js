/* アニノベル ニュースレター購読 モジュール
 * バックエンド未稼働時はlocalStorageキューに保存
 *
 * 設定:
 *   window.ANINOVEL_NEWSLETTER_API='https://api.aninovel.com/newsletter';
 */
(function(){
  'use strict';
  var QUEUE_KEY='aninovel_newsletter_queue_v1';
  var API=window.ANINOVEL_NEWSLETTER_API||null;

  function load(){try{return JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]');}catch(e){return [];}}
  function save(q){try{localStorage.setItem(QUEUE_KEY,JSON.stringify(q));}catch(e){}}

  function isAlreadySubscribed(email){
    return load().some(function(s){return s.email===email&&s.status!=='unsubscribed';});
  }

  async function subscribe(email,prefs){
    if(!email||!/^\S+@\S+\.\S+$/.test(email)){throw new Error('メールアドレス形式が不正');}
    var rec={
      email:email.toLowerCase().trim(),
      prefs:prefs||{weekly:true,announcements:true,votes:true},
      status:'pending',
      ts:new Date().toISOString(),
      source:(typeof location!=='undefined')?location.pathname:''
    };
    if(API){
      try{
        var r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rec)});
        if(!r.ok)throw new Error('HTTP '+r.status);
        var data=await r.json();
        return data;
      }catch(e){console.warn('[Newsletter] API失敗、ローカル保留',e);}
    }
    // ローカル保留
    var q=load();q.push(rec);save(q);
    return {queued:true,message:'登録要求を受け付けました(送信は接続復帰後)'};
  }

  function openSubscribeModal(){
    var existing=document.getElementById('aninovel-newsletter-modal');if(existing)existing.remove();
    var ov=document.createElement('div');
    ov.id='aninovel-newsletter-modal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Zen Kaku Gothic New",system-ui,sans-serif';
    ov.onclick=function(e){if(e.target===ov)ov.remove();};
    var bx=document.createElement('div');
    bx.style.cssText='background:#fff;border-radius:12px;max-width:440px;width:100%;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.4)';
    bx.innerHTML=
      '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><h3 style="font-size:18px;font-weight:700">📬 メールマガジン購読</h3><button id="annl-close" style="border:none;background:transparent;font-size:22px;cursor:pointer">&times;</button></div>'
      +'<p style="font-size:13px;color:#666;margin-bottom:18px">週1回、新着作品やランキングをお届けします。<br>いつでも配信停止できます。</p>'
      +'<div style="margin-bottom:14px"><label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">メールアドレス</label><input id="annl-email" type="email" required placeholder="example@example.com" style="width:100%;padding:10px;border:1px solid #E2DCD4;border-radius:6px;font-family:inherit"></div>'
      +'<div style="margin-bottom:14px;font-size:13px"><label style="display:block;margin-bottom:6px;font-weight:600">配信内容</label>'
      +'<label style="display:flex;align-items:center;gap:8px;padding:6px"><input type="checkbox" id="annl-pref-weekly" checked> 週次ダイジェスト(新着・ランキング)</label>'
      +'<label style="display:flex;align-items:center;gap:8px;padding:6px"><input type="checkbox" id="annl-pref-announce" checked> お知らせ・新機能案内</label>'
      +'</div>'
      +'<div style="margin-bottom:14px"><label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#666"><input type="checkbox" id="annl-pledge"> <a href="/aninovel/legal/privacy.html" style="color:#C0392B" target="_blank">プライバシーポリシー</a>に同意します</label></div>'
      +'<button id="annl-submit" style="width:100%;padding:12px;background:#C0392B;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">購読する</button>'
      +'<p id="annl-msg" style="margin-top:10px;font-size:12px;text-align:center;display:none"></p>';
    ov.appendChild(bx);document.body.appendChild(ov);

    function close(){ov.remove();}
    document.getElementById('annl-close').onclick=close;
    document.getElementById('annl-submit').onclick=async function(){
      var email=document.getElementById('annl-email').value.trim();
      var pledge=document.getElementById('annl-pledge').checked;
      var msg=document.getElementById('annl-msg');msg.style.display='block';
      if(!email||!/^\S+@\S+\.\S+$/.test(email)){msg.textContent='メールアドレスが不正です';msg.style.color='#C0392B';return;}
      if(!pledge){msg.textContent='プライバシーポリシーへの同意が必要です';msg.style.color='#C0392B';return;}
      if(isAlreadySubscribed(email)){msg.textContent='既に登録されています';msg.style.color='#666';return;}
      var prefs={weekly:document.getElementById('annl-pref-weekly').checked,announcements:document.getElementById('annl-pref-announce').checked};
      try{
        await subscribe(email,prefs);
        bx.innerHTML='<div style="text-align:center;padding:30px"><div style="font-size:48px;margin-bottom:12px">✉️</div><h3 style="font-weight:700;color:#10B981;margin-bottom:8px">登録要求を受付ました</h3><p style="color:#666;font-size:13px;line-height:1.7">入力されたメールアドレスに確認メールが届きます。<br>記載のリンクをクリックして購読を確定してください。<br><small style="color:#999">※ メールが届かない場合は迷惑メールフォルダもご確認ください</small></p><button id="annl-done" style="margin-top:20px;padding:10px 24px;background:#3D3A36;color:#fff;border:none;border-radius:6px;cursor:pointer">閉じる</button></div>';
        document.getElementById('annl-done').onclick=close;
        try{if(window.gtag)gtag('event','newsletter_signup',{method:'modal'});}catch(_){}
      }catch(e){msg.textContent='エラー: '+e.message;msg.style.color='#C0392B';}
    };
  }

  // フッター用 1行フォーム
  function renderInlineForm(targetEl){
    targetEl.innerHTML='<form id="annl-inline" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><input type="email" required placeholder="メールアドレス" style="flex:1;min-width:180px;padding:10px;border:1px solid #888;border-radius:6px;background:transparent;color:inherit;font-family:inherit"><button style="padding:10px 16px;background:#C0392B;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">📬 購読</button></form><p id="annl-inline-msg" style="font-size:11px;margin-top:6px;opacity:.7"></p>';
    targetEl.querySelector('#annl-inline').onsubmit=async function(e){
      e.preventDefault();
      var email=this.querySelector('input').value.trim();
      var m=targetEl.querySelector('#annl-inline-msg');
      try{await subscribe(email,{weekly:true,announcements:true});m.textContent='✓ 登録要求を受付ました。確認メールをお待ちください。';m.style.color='#10B981';this.reset();}
      catch(err){m.textContent='エラー: '+err.message;m.style.color='#FFB39B';}
    };
  }

  window.AninovelNewsletter={
    openSubscribeModal:openSubscribeModal,
    subscribe:subscribe,
    renderInlineForm:renderInlineForm,
    queued:load
  };
})();
