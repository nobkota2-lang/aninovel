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
    if(u&&SUPPORTED.indexOf(u)>=0){try{localStorage.setItem(STORE_KEY,u);localStorage.setItem('aninovel_lang',u);}catch(e){}return u;}
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

  var JA2EN={'本文へスキップ':'Skip to content','オーナーモード':'Owner Mode','👑 オーナーモード':'👑 Owner Mode','青空文庫シリーズ':'Aozora Bunko Series','📚 青空文庫シリーズ':'📚 Aozora Bunko Series','著作権の保護期間が満了した名作を、アニメ風の語りでお楽しみいただけます。':'Enjoy classic masterpieces in the public domain, told in anime style.','アニノベル':'AniNovel','作品ポータル':'Works Portal','物語の世界へようこそ':'Welcome to the World of Stories','オリジナル小説を読んで、投票して、お気に入りを見つけよう':'Read original novels, vote, and find your favorites','アニノベルとは':'About AniNovel','アニノベルは、アニメ風の吹き出し表示で小説を読める新しい読書プラットフォームです。':'AniNovel is a new reading platform where you can read novels with anime-style speech bubbles.','「読者」と「作者」、2つのモードで物語の世界をお楽しみいただけます。':'Enjoy the world of stories in two modes: Reader and Author.','読者モード':'Reader Mode','立ち読みはログイン不要！':'No login required to browse!','作品を自由に閲覧できます。気に入った作品に投票もできます。':'Browse works freely. You can also vote for works you like.','ログインすると使える機能':'Features available when signed in','🔖 しおり機能 — 読みかけのページを記録':'🔖 Bookmarks — save your reading position','🎨 キャラカスタマイズ — 登場人物のアイコンや吹き出しの色を自分好みに変更（ナレーターも対応）':'🎨 Character customization — change icons and bubble colors to your taste (narrator supported)','❤ 投票 — お気に入り作品を応援':'❤ Voting — support your favorite works','※カスタマイズしない場合は作者推奨の設定がそのまま使われます。':'* If you do not customize, the author-recommended settings are used as-is.','登録に必要なもの:':'Required to register:','のみ':'only','📨 読者として新規登録':'📨 Sign up as Reader','作者モード':'Author Mode','自分のオリジナル作品を投稿・編集できます。ドラッグ＆ドロップで簡単に構成を変更。':'Post and edit your own original works. Rearrange structure easily with drag and drop.','主な機能':'Main features','📝 ビジュアルエディタ — 吹き出し形式でリアルタイム編集':'📝 Visual editor — real-time editing in bubble format','👤 キャラクター管理 — アイコン・色・プロフィール設定':'👤 Character management — icon, color, and profile settings','📂 多形式インポート — TXT / DOCX / PDF / EPUB 対応':'📂 Multi-format import — TXT / DOCX / PDF / EPUB supported','📤 エクスポート — .aninovel 形式で保存・共有':'📤 Export — save and share in .aninovel format','メールアドレス + 個人情報':'Email + personal info','（氏名・住所・電話番号）':'(name, address, phone)','※メールアドレスに仮登録情報を送信し、記載URLにアクセスすると本登録完了です。':'* We send provisional registration info to your email; visiting the link completes registration.','✏ 作者として新規登録':'✏ Sign up as Author','📚 マイ作品':'📚 My Works','🔒 アカウント登録の流れ':'🔒 Registration steps','メールアドレスと必要事項を入力して仮登録':'Enter your email and required details for provisional registration','届いたメールの確認URLをクリック':'Click the confirmation link in the email you receive','本登録完了！すべての機能が利用可能に':'Registration complete! All features unlocked','パスワードをお忘れの場合は、ログイン画面の「パスワードを忘れた方」からメールで再設定できます。':'If you forget your password, you can reset it by email via "Forgot your password?" on the sign-in screen.','作品一覧':'Works','ランキング':'Ranking','❤ 投票数':'❤ Votes','🆕 新着順':'🆕 Newest','📝 文字数':'📝 Characters','📖 ページ数':'📖 Pages','マニュアル':'Manual','ログイン / 新規登録':'Sign in / Sign up','利用規約':'Terms of Service','プライバシーポリシー':'Privacy Policy','特商法表記':'Commercial Disclosure','著作権窓口':'Copyright Notice','アクセシビリティ':'Accessibility','💎 プラン':'💎 Plans','📤 シェア':'📤 Share','📬 メルマガ購読':'📬 Newsletter','アニノベル © 2026':'AniNovel © 2026','アカウント':'Account','📖 作品を見る':'📖 Browse works','アニメ風の吹き出しとキャラクターで小説が動き出す、新しい読書体験。':'A new reading experience — novels come alive with anime-style speech bubbles and characters.','ログイン不要で読めます':'Read free, no login required','アニノベルとは？':'About AniNovel','ログイン':'Sign in','新規登録':'Sign up','メールアドレス':'Email','パスワード':'Password','パスワードを忘れた方はこちら':'Forgot your password?','アカウント種別':'Account type','表示名':'Display name','パスワード（6文字以上）':'Password (6+ characters)','氏名（本名）':'Full name','住所':'Address','電話番号':'Phone number','仮登録する':'Register','パスワード再設定':'Reset password','再設定メールを送信':'Send reset email','新しいパスワード（6文字以上）':'New password (6+ characters)','パスワード確認':'Confirm password','パスワードを再設定':'Reset password','作者登録':'Author registration','読者登録':'Reader registration','モード切替':'Switch mode','ダッシュボード':'Dashboard','マイ作品':'My works','管理パネル':'Admin panel','投稿を取り下げる':'Unpublish','読者に公開する':'Publish to readers','ログアウト':'Sign out','テーマ切替':'Toggle theme','作品数':'Works','作者数':'Authors','総文字数':'Total characters','投票した作品はまだありません。':'No voted works yet.','しおりはまだありません。':'No bookmarks yet.','新しい作品':'New work','投票しました':'Voted','投票を取り消しました':'Vote removed','ログインしました':'Signed in','ログアウトしました':'Signed out','本登録が完了しました！':'Registration complete!','パスワードが一致しません':'Passwords do not match','取り下げました':'Unpublished','投稿しました！':'Published!','削除しました':'Deleted','作成しました':'Created','復活しました':'Restored','停止しました':'Stopped','再開しました':'Resumed','公開停止しました':'Unpublished','削除に失敗しました':'Failed to delete','作者ログインが必要です':'Author sign-in required','作者アカウントのみ利用できます':'Available to author accounts only','コンテンツがない作品は投稿できません':'Cannot publish a work with no content','作品タイトルを入力してください':'Please enter a work title','削除しました（サーバー未同期の可能性）':'Deleted (server may be out of sync)','🔍 作品を探す':'🔍 Find a work','作品名・著者・本文で検索...':'Search by title, author, or text...','すべての長さ':'Any length','短編（〜5000字）':'Short (up to 5,000 chars)','中編（5000〜20000字）':'Medium (5,000–20,000 chars)','長編（20000字〜）':'Long (20,000+ chars)','リセット':'Reset','😔 該当する作品が見つかりませんでした':'😔 No works found','メニュー':'Menu','モード':'Mode','現在のモード:':'Current mode:','モードに切り替えました':'Switched mode','読者':'Reader','作者':'Author','読者（メールアドレスのみ）':'Reader (email only)','作者（個人情報の登録が必要）':'Author (personal info required)','作者:':'Author:','オーナー':'Owner','全て':'All','更新:':'Updated:','ユーザーがいません':'No users','作品がありません':'No works','まだ作品がありません。下の「新規作成」からはじめましょう。':'No works yet. Start by clicking “New” below.','ヘッダー右上の ✏️ から「マイ作品」を開いて新規作成・編集、📊 からダッシュボードを確認できます。':'Open “My Works” from the ✏️ button at the top-right to create/edit; check the dashboard from 📊.','しおり・投票・キャラカスタマイズが使えます。📊 からダッシュボードを確認できます。':'Bookmarks, voting, and character customization are available. Open the dashboard from 📊.','登録済みのメールアドレスを入力してください。パスワード再設定用のメールを送信します。':'Enter your registered email address. We will send a password reset link.','新しいパスワード':'New password','仮登録完了':'Provisional registration complete','確認メールを送信しました':'Confirmation email sent','ログイン画面に戻る':'Back to sign-in','メール確認をシミュレート（本登録）':'Simulate email confirmation (complete registration)','作者登録には個人情報が必要です。これらの情報は作品の権利管理のために使用されます。':'Author registration requires personal info, used for rights management of your works.','📢 上書き公開':'📢 Republish','上書き公開':'Republish','オーナー権限で既存作品（デモ等）を上書き公開':'Republish existing work with owner privileges','公開保存しました！':'Saved and published!','公開保存エラー: ':'Publish error: ','この作品IDはサーバーに上書き公開できません。':'This work ID cannot be republished to the server.','作品ID:':'Work ID:','受け入れる形式: 先頭がアルファベット、続けて [A-Za-z0-9_-]（最大100文字）':'Allowed format: starts with a letter, then [A-Za-z0-9_-], max 100 chars'};
  function autoTranslateDOM(root){if(currentLang!=='en')return;root=root||document.body;if(!root)return;try{var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null,false);var nd,arr=[];while(nd=w.nextNode())arr.push(nd);for(var i=0;i<arr.length;i++){var t=arr[i].nodeValue;if(!t)continue;var k=t.trim();if(!k)continue;var hit=JA2EN[k];if(hit&&hit!==k)arr[i].nodeValue=t.replace(k,hit);}if(root.querySelectorAll){var els=root.querySelectorAll('[title],[placeholder]');for(var j=0;j<els.length;j++){['title','placeholder'].forEach(function(a){var v=els[j].getAttribute(a);if(v==null)return;var k2=v.trim();var h2=JA2EN[k2];if(h2&&h2!==k2)els[j].setAttribute(a,v.replace(k2,h2));});}}}catch(e){}}
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
      autoTranslateDOM(document.body);setTimeout(function(){_applying=false;},0);
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
      var hasI18n=muts.some(function(m){
        for(var i=0;i<m.addedNodes.length;i++){
          var n=m.addedNodes[i];
          if(currentLang==='en'&&n.nodeType===1)return true;if(n.nodeType===1&&(n.matches&&(n.matches('[data-i18n]')||n.querySelector('[data-i18n]'))))return true;
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
    apply:applyToDOM,
    SUPPORTED:SUPPORTED,
    renderSwitcher:renderSwitcher
  };
  window.__ANINOVEL_I18N_VER__='i18n_full_v5';console.info('[i18n] 言語=',currentLang);
})();
