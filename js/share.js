/* アニノベル SNSシェア モジュール
 * 機能:
 *   - X(Twitter), Threads, LINE, Facebook, はてブ, コピー, OS共有(Web Share API)
 *   - 作品ページ用の専用テキスト生成
 *   - シェア計測(GA4 イベント連携)
 *
 * 使い方:
 *   AninovelShare.openMenu({title:'作品名', url:'https://...', text:'紹介文'})
 *   または既存ボタンに data-share属性で:
 *     <button data-aninovel-share="auto">📤 シェア</button>
 */
(function(){
  'use strict';

  function gtagEvent(action,label){
    try{if(window.gtag)gtag('event','share',{method:action,content_id:label||location.pathname});}catch(e){}
  }

  function defaultText(opts){
    var title=opts.title||document.title;
    return '「'+title+'」#アニノベル';
  }

  function intentUrl(net,opts){
    var url=encodeURIComponent(opts.url||location.href);
    var text=encodeURIComponent(opts.text||defaultText(opts));
    var title=encodeURIComponent(opts.title||document.title);
    switch(net){
      case 'x':       return 'https://x.com/intent/post?text='+text+'&url='+url+'&hashtags=アニノベル';
      case 'threads': return 'https://www.threads.net/intent/post?text='+text+'%20'+url;
      case 'line':    return 'https://line.me/R/share?text='+text+'%20'+url;
      case 'facebook':return 'https://www.facebook.com/sharer/sharer.php?u='+url;
      case 'hatena':  return 'https://b.hatena.ne.jp/entry/panel/?url='+url+'&btitle='+title;
      case 'reddit':  return 'https://www.reddit.com/submit?url='+url+'&title='+title;
    }
    return null;
  }

  function open(net,opts){
    var u=intentUrl(net,opts);
    if(!u)return;
    gtagEvent(net,opts.title);
    window.open(u,'aninovel-share','width=620,height=520,noopener,noreferrer');
  }

  async function copyLink(opts){
    try{
      await navigator.clipboard.writeText(opts.url||location.href);
      gtagEvent('copy',opts.title);
      return true;
    }catch(e){return false;}
  }

  async function nativeShare(opts){
    if(!navigator.share)return false;
    try{
      await navigator.share({
        title:opts.title||document.title,
        text:opts.text||defaultText(opts),
        url:opts.url||location.href
      });
      gtagEvent('native',opts.title);
      return true;
    }catch(e){return false;}
  }

  function openMenu(opts){
    opts=opts||{};
    var existing=document.getElementById('aninovel-share-menu');if(existing)existing.remove();

    var ov=document.createElement('div');
    ov.id='aninovel-share-menu';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:flex-end;justify-content:center;font-family:"Zen Kaku Gothic New",system-ui,sans-serif';
    ov.onclick=function(e){if(e.target===ov)ov.remove();};

    var bx=document.createElement('div');
    bx.style.cssText='background:#fff;color:#2D2A26;width:100%;max-width:520px;border-radius:16px 16px 0 0;padding:24px;animation:anslideup .2s ease-out';
    var st=document.createElement('style');st.textContent='@keyframes anslideup{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';document.head.appendChild(st);

    var nets=[
      {id:'x',label:'X (Twitter)',color:'#000',icon:'𝕏'},
      {id:'threads',label:'Threads',color:'#000',icon:'@'},
      {id:'line',label:'LINE',color:'#06C755',icon:'LINE'},
      {id:'facebook',label:'Facebook',color:'#1877F2',icon:'f'},
      {id:'hatena',label:'はてブ',color:'#00A4DE',icon:'B!'},
    ];

    var grid=nets.map(function(n){return '<button data-share-net="'+n.id+'" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border:1px solid #E2DCD4;background:#fff;border-radius:12px;cursor:pointer;transition:transform .1s"><div style="width:44px;height:44px;border-radius:50%;background:'+n.color+';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">'+n.icon+'</div><div style="font-size:11px;color:#444">'+n.label+'</div></button>';}).join('');

    var canNative=!!navigator.share;
    bx.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><h3 style="font-size:16px;font-weight:700">📤 シェア</h3><button id="anshare-close" style="border:none;background:transparent;font-size:22px;cursor:pointer">&times;</button></div>'
      +'<div style="background:#F5EFE6;padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#555">'+(opts.title||document.title)+'</div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:10px;margin-bottom:16px">'+grid+'</div>'
      +'<div style="display:flex;gap:8px"><button id="anshare-copy" style="flex:1;padding:12px;background:#3D3A36;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">🔗 リンクをコピー</button>'
      +(canNative?'<button id="anshare-native" style="flex:1;padding:12px;background:#C0392B;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">📲 OSの共有</button>':'')
      +'</div>';
    ov.appendChild(bx);
    document.body.appendChild(ov);
    document.getElementById('anshare-close').onclick=function(){ov.remove();};
    bx.querySelectorAll('[data-share-net]').forEach(function(b){
      b.onclick=function(){open(b.dataset.shareNet,opts);ov.remove();};
    });
    document.getElementById('anshare-copy').onclick=async function(){
      var ok=await copyLink(opts);
      this.textContent=ok?'✓ コピーしました':'❌ コピー失敗';
      this.style.background='#10B981';
      setTimeout(function(){ov.remove();},900);
    };
    var nb=document.getElementById('anshare-native');if(nb)nb.onclick=function(){nativeShare(opts);ov.remove();};
  }

  // <[data-aninovel-share]>属性のあるボタンに自動バインド
  function bindAuto(){
    document.querySelectorAll('[data-aninovel-share]').forEach(function(el){
      if(el.dataset.shareWired)return;el.dataset.shareWired='1';
      el.addEventListener('click',function(e){
        e.preventDefault();
        var opts={};
        if(el.dataset.shareTitle)opts.title=el.dataset.shareTitle;
        if(el.dataset.shareText)opts.text=el.dataset.shareText;
        if(el.dataset.shareUrl)opts.url=el.dataset.shareUrl;
        openMenu(opts);
      });
    });
  }

  // 動的追加にも対応
  if(document.readyState!=='loading')bindAuto();
  document.addEventListener('DOMContentLoaded',bindAuto);
  new MutationObserver(bindAuto).observe(document.documentElement,{childList:true,subtree:true});

  window.AninovelShare={openMenu:openMenu,open:open,copyLink:copyLink,nativeShare:nativeShare};
})();
