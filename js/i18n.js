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
      'site.portal':'作品ポータル','btn.theme':'テーマ切替',
      'about.title':'アニノベルとは','about.lead':'アニノベルは、アニメ風の吹き出し表示で小説を読める新しい読書プラットフォームです。「読者」と「作者」、2つのモードで物語の世界をお楽しみいただけます。',
      'reader.desc':'作品を自由に閲覧できます。気に入った作品に投票もできます。','reader.features':'ログインすると使える機能',
      'reader.feat.bookmark':'🔖 しおり機能 — 読みかけのページを記録','reader.feat.custom':'🎨 キャラカスタマイズ — 登場人物のアイコンや吹き出しの色を自分好みに変更（ナレーターも対応）','reader.feat.vote':'❤ 投票 — お気に入り作品を応援',
      'reader.note':'※カスタマイズしない場合は作者推奨の設定がそのまま使われます。','reader.reg':'登録に必要なもの: メールアドレスのみ',
      'author.desc':'自分のオリジナル作品を投稿・編集できます。ドラッグ＆ドロップで簡単に構成を変更。','author.features':'主な機能',
      'author.feat.editor':'📝 ビジュアルエディタ — 吹き出し形式でリアルタイム編集','author.feat.char':'👤 キャラクター管理 — アイコン・色・プロフィール設定','author.feat.import':'📂 多形式インポート — TXT / DOCX / PDF / EPUB 対応','author.feat.export':'📤 エクスポート — .aninovel 形式で保存・共有',
      'author.reg':'登録に必要なもの: メールアドレス + 個人情報（氏名・住所・電話番号）','author.note':'※メールアドレスに仮登録情報を送信し、記載URLにアクセスすると本登録完了です。',
      'flow.title':'🔒 アカウント登録の流れ','flow.step1':'メールアドレスと必要事項を入力して仮登録','flow.step2':'届いたメールの確認URLをクリック','flow.step3':'本登録完了！すべての機能が利用可能に','flow.note':'パスワードをお忘れの場合は、ログイン画面の「パスワードを忘れた方」からメールで再設定できます。',
      'nav.accessibility':'アクセシビリティ','stats.works':'作品数','stats.authors':'作者数','stats.chars':'総文字数',
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
      'site.portal':'Works Portal','btn.theme':'Toggle theme',
      'about.title':'About Aninovel','about.lead':'Aninovel is a new reading platform where you can read novels in anime-style speech bubbles. Enjoy the world of stories in two modes: Reader and Author.',
      'reader.desc':'Browse works freely. You can also vote for works you like.','reader.features':'Features available after signing in',
      'reader.feat.bookmark':'🔖 Bookmarks — Save your reading position','reader.feat.custom':'🎨 Character customization — Change character icons and bubble colors to your taste (narrator included)','reader.feat.vote':'❤ Voting — Support your favorite works',
      'reader.note':'* If you do not customize, the recommended settings are used.','reader.reg':'Required to register: email address only',
      'author.desc':'Post and edit your own original works. Rearrange structure easily with drag & drop.','author.features':'Main features',
      'author.feat.editor':'📝 Visual editor — Real-time editing in bubble format','author.feat.char':'👤 Character management — Set icons, colors, and profiles','author.feat.import':'📂 Multi-format import — TXT / DOCX / PDF / EPUB','author.feat.export':'📤 Export — Save and share as .aninovel',
      'author.reg':'Required to register: email + personal info (name, address, phone)','author.note':'* We email you provisional registration info; open the URL inside to complete sign-up.',
      'flow.title':'🔒 Account Registration Flow','flow.step1':'Enter your email and details to pre-register','flow.step2':'Click the confirmation URL in the email','flow.step3':'Registration complete! All features unlocked','flow.note':'Forgot your password? Reset it by email via the "Forgot password" link on the login screen.',
      'nav.accessibility':'Accessibility','stats.works':'Works','stats.authors':'Authors','stats.chars':'Total characters',
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

  // ===== 固定UI文字列の日本語→英語 自動置換マップ（data-i18n非対応の動的描画用） =====
  var JA2EN={
    'マイ作品':'My Works','ログイン':'Sign in','ログアウト':'Sign out','ログインしました':'Signed in','ログアウトしました':'Signed out',
    '作者登録':'Register as Author','読者登録':'Register as Reader','アカウント':'Account','モード切替':'Switch mode','ダッシュボード':'Dashboard','管理パネル':'Admin panel','新しい作品':'New work',
    '表示名':'Display name','氏名（本名）':'Full name (legal)','メールアドレス':'Email address','電話番号':'Phone number','住所':'Address','パスワード（6文字以上）':'Password (6+ characters)','パスワード再設定':'Reset password','再設定メールを送信':'Send reset email',
    '作成しました':'Created','停止しました':'Suspended','再開しました':'Resumed','削除しました':'Deleted','復活しました':'Restored','取り下げました':'Withdrawn','投稿しました！':'Published!','公開停止しました':'Unpublished','本登録が完了しました！':'Registration complete!',
    '投稿を取り下げる':'Withdraw submission','作品がありません':'No works','ユーザーがいません':'No users','削除に失敗しました':'Delete failed','作者ログインが必要です':'Author sign-in required','作品タイトルを入力してください':'Please enter a work title','作者アカウントのみ利用できます':'Available to author accounts only','コンテンツがない作品は投稿できません':'Cannot publish a work with no content',
    'しおりはまだありません。':'No bookmarks yet.','投票した作品はまだありません。':'No voted works yet.','まだ作品がありません。下の「新規作成」からはじめましょう。':'No works yet. Start from \u201cNew\u201d below.',
    'メール確認をシミュレート（本登録）':'Simulate email verification (complete sign-up)','削除しました（サーバー未同期の可能性）':'Deleted (may not be synced to server)',
    '作者登録には個人情報が必要です。これらの情報は作品の権利管理のために使用されます。':'Author registration requires personal info, used for rights management of works.',
    '登録済みのメールアドレスを入力してください。パスワード再設定用のメールを送信します。':'Enter your registered email address. We will send a password reset email.',
    'Phase 1 デモ: 実際のメール送信は行われません。下のボタンで本登録をシミュレートします。':'Phase 1 demo: no real email is sent. Use the button below to simulate sign-up.',
    'オーナー':'Owner','作者':'Author','読者':'Reader',
    '\u270F\uFE0F 編集':'\u270F\uFE0F Edit','\uD83D\uDCE4 投稿':'\uD83D\uDCE4 Publish','\uD83D\uDCE5 取下':'\uD83D\uDCE5 Withdraw','\u2714 投稿済':'\u2714 Published','投稿しました！':'Published!','取り下げました':'Withdrawn','新規作成':'New','\uFF0B 新規作成':'\uFF0B New'
  };
  function translateTextNodes(root){
    if(currentLang!=='en'||!root||!document.body)return;
    try{
      var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){
        var p=n.parentNode;if(!p)return NodeFilter.FILTER_REJECT;
        var tg=p.nodeName;if(tg==='SCRIPT'||tg==='STYLE'||tg==='TEXTAREA')return NodeFilter.FILTER_REJECT;
        var t=n.nodeValue;if(!t||!t.trim())return NodeFilter.FILTER_REJECT;
        return JA2EN.hasOwnProperty(t.trim())?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
      }});
      var arr=[],x;while(x=w.nextNode())arr.push(x);
      arr.forEach(function(n){var k=n.nodeValue.trim();if(JA2EN[k]!=null)n.nodeValue=n.nodeValue.replace(k,JA2EN[k]);});
    }catch(e){}
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
      if(currentLang==='en')translateTextNodes(document.body);
    }finally{
      // 自分が起こしたMutationが届く前に待ってから解除
      setTimeout(function(){_applying=false;},0);
    }
  }

  function setLang(lang){
    if(SUPPORTED.indexOf(lang)<0)return;
    currentLang=lang;
    try{localStorage.setItem(STORE_KEY,lang);}catch(e){}
    applyToDOM();
  }

  function renderSwitcher(targetEl){
    targetEl=targetEl||document.body;
    var wrap=document.createElement('div');
    wrap.className='aninovel-lang-switcher';
    wrap.style.cssText='display:inline-flex;align-items:center;gap:4px;font-size:12px';
    wrap.innerHTML=SUPPORTED.map(function(l){
      var label=l==='ja'?(currentLang==='en'?'Japanese':'日本語'):l==='en'?'English':l;
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
      var hasAdded=muts.some(function(m){
        for(var i=0;i<m.addedNodes.length;i++){if(m.addedNodes[i].nodeType===1)return true;}
        return false;
      });
      if(!hasAdded)return;
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
    renderSwitcher:renderSwitcher,
    apply:applyToDOM
  };
  console.info('[i18n] 言語=',currentLang);
})();
