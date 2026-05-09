/* アニノベル アクセシビリティ補強JS
 * 役割:
 *   - スキップリンク自動挿入
 *   - 動的に作られるモーダルに focus trap
 *   - toast/alert に aria-live 付与
 *   - 主要ランドマーク確認
 */
(function(){
  'use strict';

  // ===== スキップリンク追加 =====
  function injectSkipLink(){
    if(document.querySelector('.aninovel-skip-link'))return;
    var sk=document.createElement('a');
    sk.className='aninovel-skip-link';
    sk.href='#main';
    sk.textContent='本文へスキップ';
    document.body.insertBefore(sk,document.body.firstChild);
    // <main id="main"> がない場合は最初の <main>/<section>に id付与
    if(!document.getElementById('main')){
      var m=document.querySelector('main')||document.querySelector('section');
      if(m)m.id='main';
    }
  }

  // ===== focus trap (モーダル内でTabが外に出ないようにする) =====
  function trapFocus(modal){
    if(!modal)return function(){};
    var focusables=modal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    if(!focusables.length)return function(){};
    var first=focusables[0],last=focusables[focusables.length-1];
    var prevFocus=document.activeElement;
    function onKey(e){
      if(e.key==='Escape'){var b=modal.querySelector('[data-close],[aria-label*="閉じる"]');if(b)b.click();}
      if(e.key!=='Tab')return;
      if(e.shiftKey){if(document.activeElement===first){e.preventDefault();last.focus();}}
      else{if(document.activeElement===last){e.preventDefault();first.focus();}}
    }
    modal.addEventListener('keydown',onKey);
    setTimeout(function(){first.focus();},50);
    return function(){
      modal.removeEventListener('keydown',onKey);
      try{prevFocus&&prevFocus.focus();}catch(e){}
    };
  }

  // ===== 自動的にモーダルを検出して focus trap =====
  var observed=new WeakSet();
  function observeModals(){
    document.querySelectorAll('.modal-overlay,#aninovel-report-modal,#aninovel-pricing-modal,#aninovel-share-menu,#aninovel-newsletter-modal,#aninovel-mod-panel').forEach(function(m){
      if(observed.has(m))return;observed.add(m);
      m.setAttribute('role','dialog');
      m.setAttribute('aria-modal','true');
      trapFocus(m);
    });
  }

  // ===== toast に aria-live =====
  function ensureLiveRegion(){
    if(document.getElementById('aninovel-live'))return;
    var l=document.createElement('div');
    l.id='aninovel-live';
    l.setAttribute('aria-live','polite');
    l.setAttribute('aria-atomic','true');
    l.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)';
    document.body.appendChild(l);
  }
  window.AninovelA11yAnnounce=function(msg){
    var l=document.getElementById('aninovel-live');if(l)l.textContent=msg;
  };

  // 既存の showToast/console を傍受してアナウンス
  if(typeof window.showToast==='function'){
    var _orig=window.showToast;
    window.showToast=function(msg){window.AninovelA11yAnnounce(msg);return _orig.apply(this,arguments);};
  }

  // ===== 画像に alt が無いものに警告 (開発モード) =====
  function checkAltTags(){
    if(location.hostname!=='localhost'&&location.hostname!=='127.0.0.1')return;
    document.querySelectorAll('img:not([alt])').forEach(function(img){
      console.warn('[a11y] alt属性が未設定:',img.src||img);
    });
  }

  function init(){
    injectSkipLink();
    ensureLiveRegion();
    observeModals();
    checkAltTags();
    // 動的追加にも対応(無限ループ防止: childListのみ、debounce)
    var _t=null;
    new MutationObserver(function(muts){
      var hasNew=muts.some(function(m){return m.addedNodes&&m.addedNodes.length>0;});
      if(!hasNew)return;
      if(_t)return;
      _t=setTimeout(function(){_t=null;observeModals();},100);
    }).observe(document.body,{childList:true,subtree:false});
  }
  if(document.readyState!=='loading')init();
  else document.addEventListener('DOMContentLoaded',init);
})();
