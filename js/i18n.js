/* アニノベル 多言語化 i18n
 * 軽量実装: JSONベース、SSR不要、URL ?lang= or localStorage で切替
 *
 * 使い方:
 *   <span data-i18n="welcome">ようこそ</span>
 *   <button data-i18n="login" data-i18n-attr="title">ログイン</button>
 *   AninovelI18n.t('welcome') // "Welcome"
 *
 * 対応言語: ja(default), en
 * 将来追加: zh-CN, ko, vi, es ...
 */
(function(){
  'use strict';
  var STORE_KEY='aninovel_lang_v1';
  var DEFAULT_LANG='ja';
  var SUPPORTED=['ja','en'];

  // ===== 翻訳辞書(主要メニュー・ボタンのみ。本文翻訳は対象外) =====
  var DICT={
    ja:{
      'site.name':'アニノベル',
      'site.tagline':'物語の世界へようこそ',
      'site.subtitle':'オリジナル小説を読んで、投票して、お気に入りを見つけよう',
      'nav.manual':'マニュアル',
      'nav.login':'ログイン / 新規登録',
      'nav.terms':'利用規約',
      'nav.privacy':'プライバシーポリシー',
      'nav.tokushoho':'特商法表記',
      'nav.dmca':'著作権窓口',
      'nav.plan':'💎 プラン',
      'nav.share':'📤 シェア',
      'nav.newsletter':'📬 メルマガ購読',
      'mode.reader':'読者モード',
      'mode.author':'作者モード',
      'mode.reader.cta':'立ち読みはログイン不要！',
      'work.list':'作品一覧',
      'ranking':'ランキング',
      'rank.votes':'❤ 投票数',
      'rank.newest':'🆕 新着順',
      'rank.chars':'📝 文字数',
      'rank.pages':'📖 ページ数',
      'btn.register':'新規登録',
      'btn.login':'ログイン',
      'btn.mywork':'📚 マイ作品',
      'reader.signup':'📨 読者として新規登録',
      'author.signup':'✏ 作者として新規登録',
      'btn.share':'📤 シェア',
      'btn.report':'🚩 通報',
      'consent.text':'当サイトはサービス改善のためCookieを使用してアクセス状況を分析しています。',
      'consent.allow':'同意する',
      'consent.deny':'拒否する',
      'lang.label':'言語',
      'tts.play':'▶ 再生',
      'tts.stop':'⏹ 停止',
      'page.404.title':'ページが見つかりません',
      'page.404.body':'お探しの物語は、別の場所へ旅立ったか、まだ存在しないようです。',
      'page.404.back':'📖 トップに戻る'
    },
    en:{
      'site.name':'Aninovel',
      'site.tagline':'Welcome to the World of Stories',
      'site.subtitle':'Read original novels, vote, and find your favorites',
      'nav.manual':'Manual',
      'nav.login':'Sign in / Sign up',
      'nav.terms':'Terms of Service',
      'nav.privacy':'Privacy Policy',
      'nav.tokushoho':'Commercial Disclosure',
      'nav.dmca':'Copyright Notice',
      'nav.plan':'💎 Plans',
      'nav.share':'📤 Share',
      'nav.newsletter':'📬 Newsletter',
      'mode.reader':'Reader Mode',
      'mode.author':'Author Mode',
      'mode.reader.cta':'No login required to browse!',
      'work.list':'Works',
      'ranking':'Ranking',
      'rank.votes':'❤ Votes',
      'rank.newest':'🆕 Newest',
      'rank.chars':'📝 Characters',
      'rank.pages':'📖 Pages',
      'btn.register':'Sign up',
      'btn.login':'Sign in',
      'btn.mywork':'📚 My Works',
      'reader.signup':'📨 Sign up as Reader',
      'author.signup':'✏ Sign up as Author',
      'btn.share':'📤 Share',
      'btn.report':'🚩 Report',
      'consent.text':'This site uses cookies to analyze access for service improvement.',
      'consent.allow':'Accept',
      'consent.deny':'Decline',
      'lang.label':'Language',
      'tts.play':'▶ Play',
      'tts.stop':'⏹ Stop',
      'page.404.title':'Page Not Found',
      'page.404.body':"The story you're looking for has wandered off to another place, or doesn't exist yet.",
      'page.404.back':'📖 Return to Top'
    }
  };

  function detectLang(){
    var u=new URLSearchParams(location.search).get('lang');
    if(u&&SUPPORTED.indexOf(u)>=0){try{localStorage.setItem(STORE_KEY,u);}catch(e){}return u;}
    try{var s=localStorage.getItem(STORE_KEY);if(s&&SUPPORTED.indexOf(s)>=0)return s;}catch(e){}
    var nl=(navigator.language||'ja').toLowerCase();
    for(var i=0;i<SUPPORTED.length;i++){if(nl.indexOf(SUPPORTED[i])===0)return SUPPORTED[i];}
    return DEFAULT_LANG;
  }

  var currentLang=detectLang();

  function t(key){
    var d=DICT[currentLang]||DICT[DEFAULT_LANG];
    return d[key]||DICT[DEFAULT_LANG][key]||key;
  }

  var _applying=false;
  function applyToDOM(){
    if(_applying)return; // MutationObserver無限ループ防止
    _applying=true;
    try{
      document.documentElement.lang=currentLang;
      document.querySelectorAll('[data-i18n]').forEach(function(el){
        var key=el.dataset.i18n;
        var val=t(key);
        var attr=el.dataset.i18nAttr;
        if(attr){if(el.getAttribute(attr)!==val)el.setAttribute(attr,val);}
        else{if(el.textContent!==val)el.textContent=val;}
      });
    }finally{
      // 自分が起こしたMutationが届く前に待ってから解除
      setTimeout(function(){_applying=false;},0);
    }
  }

  function setLang(lang){
    if(SUPPORTED.indexOf(lang)<0)return;
    currentLang=lang;
    try{localStorage.setItem(STORE_KEY,lang);localStorage.setItem('aninovel_lang',lang);}catch(e){}
    applyToDOM();
  }

  function renderSwitcher(targetEl){
    targetEl=targetEl||document.body;
    var wrap=document.createElement('div');
    wrap.className='aninovel-lang-switcher';
    wrap.style.cssText='display:inline-flex;align-items:center;gap:4px;font-size:12px';
    wrap.innerHTML=SUPPORTED.map(function(l){
      var label=l==='ja'?'日本語':l==='en'?'English':l;
      return '<button data-lang="'+l+'" style="padding:4px 10px;border:1px solid '+(l===currentLang?'#C0392B':'transparent')+';background:'+(l===currentLang?'#C0392B':'transparent')+';color:'+(l===currentLang?'#fff':'inherit')+';border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px">'+label+'</button>';
    }).join('');
    wrap.querySelectorAll('button').forEach(function(b){
      b.onclick=function(){setLang(b.dataset.lang);location.reload();};
    });
    targetEl.appendChild(wrap);
  }

  if(document.readyState!=='loading')applyToDOM();
  else document.addEventListener('DOMContentLoaded',applyToDOM);

  // 動的追加要素にも対応(childListのみ・親要素を限定してパフォーマンス確保)
  if(typeof MutationObserver!=='undefined'){
    var _scheduled=false;
    var obs=new MutationObserver(function(muts){
      if(_applying||_scheduled)return;
      // 新しく追加された要素に data-i18n が含まれている場合のみ再適用
      var hasI18n=muts.some(function(m){
        for(var i=0;i<m.addedNodes.length;i++){
          var n=m.addedNodes[i];
          if(n.nodeType===1&&(n.matches&&(n.matches('[data-i18n]')||n.querySelector('[data-i18n]'))))return true;
        }
        return false;
      });
      if(!hasI18n)return;
      _scheduled=true;
      requestAnimationFrame(function(){_scheduled=false;applyToDOM();});
    });
    obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
  }

  window.AninovelI18n={
    t:t,
    setLang:setLang,
    getLang:function(){return currentLang;},
    SUPPORTED:SUPPORTED,
    renderSwitcher:renderSwitcher
  };
  console.info('[i18n] 言語=',currentLang);
})();
