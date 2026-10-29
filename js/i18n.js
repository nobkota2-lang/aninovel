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

  var JA2EN={'本文へスキップ':'Skip to content','作品':'Works','使い方':'How to read','／ 作品を書きたい方は':'／ If you want to write, ','の方は、そのときのパスワードを入力してください。 同じアカウントに作者の権限が加わります。':' , enter the password you chose then. Writer access is added to the same account.','%s さんとしてログインしています':'Signed in as %s','エラー (':'Error (','ログイン中です。パスワードの変更やログアウトができます。':'You are signed in. You can change your password or sign out here.','ログインしました。移動します…':'Signed in. Taking you there…','ご登録のメールアドレスを入力してください':'Please enter your registered email address','ご案内をお送りしました。':'We have sent you the instructions.','通信に失敗しました。':'The connection failed.','通信に失敗しました。時間をおいてお試しください。':'The connection failed. Please try again in a little while.','送信しています…':'Sending…','設定しています…':'Setting…','作者・読者':'Writer / Reader','パスワードを表示':'Show password','パスワードを隠す':'Hide password','パスワードは10文字以上にしてください。':'Your password must be at least 10 characters.','メールアドレスを入力してください。':'Please enter your email address.','ニックネームを入力してください。':'Please enter a display name.','お名前を入力してください。':'Please enter your name.','サイトの管理者にご連絡ください。':'Please contact the site administrator.','登録を受け付けましたが、メールを送れませんでした':'We received your registration, but could not send the email','アカウントは作られていますが、確認メールが送信できていないため、まだログインできません。':'Your account has been created, but the confirmation email could not be sent, so you cannot sign in yet.','リンクが正しくありません。メールのリンクをもう一度お開きください。':'That link is not valid. Please open the link in the email again.','確認が完了しました。':'Your email has been confirmed.','迷惑メールフォルダもご確認ください。':'Please check your spam folder as well.','ログイン画面へ移動します…':'Taking you to the sign-in screen…','読者・作者どちらも、ご登録のメールアドレスとパスワードでログインします。':'Readers and writers both sign in with the email address and password you registered.','トップへ':'Home','パスワードを変更':'Change your password','現在のパスワード':'Current password','10文字以上':'10 characters or more','変更する':'Change','パスワードを忘れた方':'Forgot your password?','読者として登録':'Sign up as a reader','作者登録の申請':'Apply to become a writer','再設定のメールが届かないときは、そのアドレスがまだ登録されていないか、':'If the reset email does not arrive, either that address is not registered yet, or ','確認メールのリンクをまだ開いていない場合です。':'you have not yet opened the link in the confirmation email.','迷惑メールフォルダもあわせてご確認ください。':'Please check your spam folder as well.','※ 管理画面（作者の承認・作品の作者指定）は、この画面ではなく':'* The admin screen (approving writers, assigning works) is not reached from here: ','メールに届く使い捨ての番号で入ります。パスワードは使いません。':'you enter it with a one-time code sent by email. No password is used.','登録すると、吹き出しの色やキャラクターのアイコンなど、':'Once you register, your reading settings — speech bubble colours, character icons and so on — ','読み方の設定を保存して、どの端末でも同じ設定で読めるようになります。':'are saved, so you read with the same settings on any device.','ニックネーム':'Display name','ログインIDになります':'This will be your sign-in ID','確認のメールをお送りします。':'We will send you a confirmation email.','数字だけ、推測されやすい語を含むものは使えません。':'Digits alone, or anything containing an easily guessed word, cannot be used.','お名前':'Your name','任意・非公開':'Optional, not shown publicly','登録する':'Register','確認メールをお送りしました':'We have sent you a confirmation email','メールに記載のリンクを開くと、登録が完了します。':'Open the link in the email to complete your registration.','届かない場合は':'If it does not arrive, check your ','迷惑メールフォルダ':'spam folder','もご確認ください。':' as well.','からお送りします。':' is the address we send from.','数分待っても届かないときは、もう一度この画面から登録し直すと再送されます。':'If nothing arrives after a few minutes, register again from this screen and we will resend it.','登録済みの方は':'Already registered? ','／\n    作品を書きたい方は':' / If you would like to write, ','メールアドレスの確認':'Confirming your email','確認しています…':'Checking…','ログインする':'Sign in','新しいパスワードを設定してください。':'Please set a new password.','設定する':'Set','パスワードを変更しました。':'Your password has been changed.','ログインへ戻る':'Back to sign-in','AniNovel で作品を公開するには、作者登録が必要です。':'To publish your work on AniNovel, you need to register as a writer.','お申し込みの内容を確認のうえ、こちらからご連絡します。':'We will review your application and get back to you.','非公開':'Not shown publicly','本名でお願いします。公開されることはありません。':'Please use your legal name. It is never made public.','非公開・ログインIDになります':'Not shown publicly; this will be your sign-in ID','承認のご連絡をこちらへお送りします。':'We will send the approval notice here.','既に':'If you are already ','読者として登録済み':'registered as a reader','の方は、そのときのパスワードを入力してください。\n      同じアカウントに作者の権限が加わります。':', enter the password you set then. Writer permissions are added to that same account.','公開':'Shown publicly','作品に表示される名前です。':'This is the name shown on your work.','自己紹介':'About you','公開・任意':'Shown publicly, optional','申請する':'Apply','申請を受け付けました':'We have received your application','内容を確認のうえ、ご登録のメールアドレスへご連絡します。':'We will review it and reply to your registered email address.','お返事が届かない場合は、':'If you do not hear back, check your ','作者になると何ができるのかは':'For what you can do as a writer, see ','作品を書く方へ':'For writers','をご覧ください。':'.','ポイント':'Points','ご自身の作品が読まれて得たポイントです。':'These are the points your work has earned from being read.','読み込んでいます…':'Loading…','トップに戻る':'Back to home','作品紹介':'The works','🎉 キャンペーン期間中につき、読者会員・作者会員は無料':'🎉 Free for readers and authors during the campaign','登録なしの立ち読みは1日5作品まで · プランを見る ›':'Up to 5 works a day without an account · See plans ›','登録なしで1日5作品まで読めます ·':'Read up to 5 works a day without an account ·','無料の会員登録でもっと読む':'Sign up free to read more','料金とプランを見る（いまはキャンペーン期間中につき無料）':'See pricing and plans (free during the campaign)','当サイトはサービス改善のため Cookie および類似技術を使用してアクセス状況を分析しています。詳しくは':'We use cookies and similar technologies to analyse site usage so that we can improve the service. For details, see our ','をご確認ください。':'.','拒否する':'Decline','同意する':'Accept','オーナーモード':'Owner Mode','👑 オーナーモード':'👑 Owner Mode','青空文庫シリーズ':'Aozora Bunko Series','📚 青空文庫シリーズ':'📚 Aozora Bunko Series','著作権の保護期間が満了した名作を、アニメ風の語りでお楽しみいただけます。':'Enjoy classic masterpieces in the public domain, told in anime style.','アニノベル':'AniNovel','作品ポータル':'Works Portal','物語の世界へようこそ':'Welcome to the World of Stories','オリジナル小説を読んで、投票して、お気に入りを見つけよう':'Read original novels, vote, and find your favorites','アニノベルとは':'About AniNovel','アニノベルは、アニメ風の吹き出し表示で小説を読める新しい読書プラットフォームです。':'AniNovel is a new reading platform where you can read novels with anime-style speech bubbles.','「読者」と「作者」、2つのモードで物語の世界をお楽しみいただけます。':'Enjoy the world of stories in two modes: Reader and Author.','読者モード':'Reader Mode','立ち読みはログイン不要！':'No login required to browse!','作品を自由に閲覧できます。気に入った作品に投票もできます。':'Browse works freely. You can also vote for works you like.','ログインすると使える機能':'Features available when signed in','🔖 しおり機能 — 読みかけのページを記録':'🔖 Bookmarks — save your reading position','🎨 キャラカスタマイズ — 登場人物のアイコンや吹き出しの色を自分好みに変更（ナレーターも対応）':'🎨 Character customization — change icons and bubble colors to your taste (narrator supported)','❤ 投票 — お気に入り作品を応援':'❤ Voting — support your favorite works','※カスタマイズしない場合は作者推奨の設定がそのまま使われます。':'* If you do not customize, the author-recommended settings are used as-is.','登録に必要なもの:':'Required to register:','のみ':'only','📨 読者として新規登録':'📨 Sign up as Reader','作者モード':'Author Mode','自分のオリジナル作品を投稿・編集できます。ドラッグ＆ドロップで簡単に構成を変更。':'Post and edit your own original works. Rearrange structure easily with drag and drop.','主な機能':'Main features','📝 ビジュアルエディタ — 吹き出し形式でリアルタイム編集':'📝 Visual editor — real-time editing in bubble format','👤 キャラクター管理 — アイコン・色・プロフィール設定':'👤 Character management — icon, color, and profile settings','📂 多形式インポート — TXT / DOCX / PDF / EPUB 対応':'📂 Multi-format import — TXT / DOCX / PDF / EPUB supported','📤 エクスポート — .aninovel 形式で保存・共有':'📤 Export — save and share in .aninovel format','メールアドレス + 個人情報':'Email + personal info','（氏名・住所・電話番号）':'(name, address, phone)','※メールアドレスに仮登録情報を送信し、記載URLにアクセスすると本登録完了です。':'* We send provisional registration info to your email; visiting the link completes registration.','✏ 作者として新規登録':'✏ Sign up as Author','📚 マイ作品':'📚 My Works','🔒 アカウント登録の流れ':'🔒 Registration steps','メールアドレスと必要事項を入力して仮登録':'Enter your email and required details for provisional registration','届いたメールの確認URLをクリック':'Click the confirmation link in the email you receive','本登録完了！すべての機能が利用可能に':'Registration complete! All features unlocked','パスワードをお忘れの場合は、ログイン画面の「パスワードを忘れた方」からメールで再設定できます。':'If you forget your password, you can reset it by email via "Forgot your password?" on the sign-in screen.','作品一覧':'Works','ランキング':'Ranking','❤ 投票数':'❤ Votes','🆕 新着順':'🆕 Newest','📝 文字数':'📝 Characters','📖 ページ数':'📖 Pages','マニュアル':'Manual','✍️ 作品を書く方へ':'✍️ For writers','収益分配':'Revenue Share','ログイン / 新規登録':'Sign in / Sign up','利用規約':'Terms of Service','プライバシーポリシー':'Privacy Policy','特商法表記':'Commercial Disclosure','著作権窓口':'Copyright Notice','アクセシビリティ':'Accessibility','💎 プラン':'💎 Plans','📤 シェア':'📤 Share','📬 メルマガ購読':'📬 Newsletter','アニノベル © 2026':'AniNovel © 2026','アカウント':'Account','📖 作品を見る':'📖 Browse works','アニメ風の吹き出しとキャラクターで小説が動き出す、新しい読書体験。':'A new reading experience — novels come alive with anime-style speech bubbles and characters.','ログイン不要で読めます':'Read free, no login required','アニノベルとは？':'About AniNovel','ログイン':'Sign in','新規登録':'Sign up','メールアドレス':'Email','パスワード':'Password','パスワードを忘れた方はこちら':'Forgot your password?','アカウント種別':'Account type','表示名':'Display name','パスワード（6文字以上）':'Password (6+ characters)','氏名（本名）':'Full name','住所':'Address','電話番号':'Phone number','仮登録する':'Register','パスワード再設定':'Reset password','再設定メールを送信':'Send reset email','新しいパスワード（6文字以上）':'New password (6+ characters)','パスワード確認':'Confirm password','パスワードを再設定':'Reset password','作者登録':'Author registration','読者登録':'Reader registration','モード切替':'Switch mode','ダッシュボード':'Dashboard','マイ作品':'My works','管理パネル':'Admin panel','投稿を取り下げる':'Unpublish','読者に公開する':'Publish to readers','ログアウト':'Sign out','テーマ切替':'Toggle theme','作品数':'Works','作者数':'Authors','総文字数':'Total characters','投票した作品はまだありません。':'No voted works yet.','しおりはまだありません。':'No bookmarks yet.','新しい作品':'New work','投票しました':'Voted','投票を取り消しました':'Vote removed','ログインしました':'Signed in','ログアウトしました':'Signed out','本登録が完了しました！':'Registration complete!','パスワードが一致しません':'Passwords do not match','取り下げました':'Unpublished','投稿しました！':'Published!','削除しました':'Deleted','作成しました':'Created','復活しました':'Restored','停止しました':'Stopped','再開しました':'Resumed','公開停止しました':'Unpublished','削除に失敗しました':'Failed to delete','作者ログインが必要です':'Author sign-in required','作者アカウントのみ利用できます':'Available to author accounts only','コンテンツがない作品は投稿できません':'Cannot publish a work with no content','作品タイトルを入力してください':'Please enter a work title','削除しました（サーバー未同期の可能性）':'Deleted (server may be out of sync)','🔍 作品を探す':'🔍 Find a work','作品名・著者・本文で検索...':'Search by title, author, or text...','すべての長さ':'Any length','短編（〜5000字）':'Short (up to 5,000 chars)','中編（5000〜20000字）':'Medium (5,000–20,000 chars)','長編（20000字〜）':'Long (20,000+ chars)','リセット':'Reset','😔 該当する作品が見つかりませんでした':'😔 No works found','メニュー':'Menu','モード':'Mode','現在のモード:':'Current mode:','モードに切り替えました':'Switched mode','読者':'Reader','作者':'Author','読者（メールアドレスのみ）':'Reader (email only)','作者（個人情報の登録が必要）':'Author (personal info required)','作者:':'Author:','オーナー':'Owner','全て':'All','更新:':'Updated:','ユーザーがいません':'No users','作品がありません':'No works','まだ作品がありません。下の「新規作成」からはじめましょう。':'No works yet. Start by clicking “New” below.','ヘッダー右上の ✏️ から「マイ作品」を開いて新規作成・編集、📊 からダッシュボードを確認できます。':'Open “My Works” from the ✏️ button at the top-right to create/edit; check the dashboard from 📊.','しおり・投票・キャラカスタマイズが使えます。📊 からダッシュボードを確認できます。':'Bookmarks, voting, and character customization are available. Open the dashboard from 📊.','登録済みのメールアドレスを入力してください。パスワード再設定用のメールを送信します。':'Enter your registered email address. We will send a password reset link.','新しいパスワード':'New password','仮登録完了':'Provisional registration complete','確認メールを送信しました':'Confirmation email sent','ログイン画面に戻る':'Back to sign-in','メール確認をシミュレート（本登録）':'Simulate email confirmation (complete registration)','作者登録には個人情報が必要です。これらの情報は作品の権利管理のために使用されます。':'Author registration requires personal info, used for rights management of your works.','📢 上書き公開':'📢 Republish','上書き公開':'Republish','オーナー権限で既存作品（デモ等）を上書き公開':'Republish existing work with owner privileges','公開保存しました！':'Saved and published!','公開保存エラー: ':'Publish error: ','この作品IDはサーバーに上書き公開できません。':'This work ID cannot be republished to the server.','作品ID:':'Work ID:','受け入れる形式: 先頭がアルファベット、続けて [A-Za-z0-9_-]（最大100文字）':'Allowed format: starts with a letter, then [A-Za-z0-9_-], max 100 chars'};
  /* 走査してはいけない場所。
   *
   * 2026-10-20: ここは文字の塊を全部見ていた。<script> と <style> の
   * 中身も文字の塊なので、走査が当たるとソースや CSS を書き換える。
   * 管理画面で実際に起きた (ソースのコメントの「2件」が「2 items」に
   * なった)。CSS の content:'▼ ここにドロップ ▼' のような、
   * 画面に効く値まで書き換わる恐れがある。
   * translate="no" / class="notranslate" も尊重する。作品名など、
   * 触ってほしくない場所に付けられるようにしておく。 */
  var _SKIP_TAGS = { SCRIPT:1, STYLE:1, NOSCRIPT:1, TEMPLATE:1, CODE:1, PRE:1, TEXTAREA:1 };
  function _skipNode(n){
    for(var e=n.parentNode; e && e.nodeType===1; e=e.parentNode){
      if(_SKIP_TAGS[e.tagName]) return true;
      if(e.getAttribute && e.getAttribute('translate')==='no') return true;
      if(e.classList && e.classList.contains('notranslate')) return true;
    }
    return false;
  }
  function autoTranslateDOM(root){if(currentLang!=='en')return;root=root||document.body;if(!root)return;try{var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return _skipNode(n)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;}},false);var nd,arr=[];while(nd=w.nextNode())arr.push(nd);for(var i=0;i<arr.length;i++){var t=arr[i].nodeValue;if(!t)continue;var k=t.trim();if(!k)continue;var hit=JA2EN[k];if(hit&&hit!==k){arr[i].nodeValue=t.replace(k,hit);}else if(FRAG_KEYS.length||RX.length){var fg=trFrag(k);if(fg!==k)arr[i].nodeValue=t.replace(k,fg);}}if(root.querySelectorAll){var els=root.querySelectorAll('[title],[placeholder]');for(var j=0;j<els.length;j++){if(_skipNode(els[j].firstChild||els[j]))continue;['title','placeholder'].forEach(function(a){var v=els[j].getAttribute(a);if(v==null)return;var k2=v.trim();var h2=JA2EN[k2];if(h2&&h2!==k2){els[j].setAttribute(a,v.replace(k2,h2));}else if(FRAG_KEYS.length||RX.length){var f2=trFrag(k2);if(f2!==k2)els[j].setAttribute(a,v.replace(k2,f2));}});}}}catch(e){}}
  // ページの題。タブ・ブックマーク・OSの共有・シェアの既定文がここを読む。
  // 英語モードのときは題も英語にし、日本語に戻したら元の題に戻す。
  // 元の題は body の data-title-ja に控えておく（legal/_legal-i18n.js と同じやり方）。
  var DOC_TITLE_EN = {
    // 認証まわりの画面 (2026-10-19 追加)
    'ログイン — AniNovel': 'Sign in — AniNovel',
    '読者登録 — AniNovel': 'Sign up as a reader — AniNovel',
    'メールアドレスの確認 — AniNovel': 'Confirm your email — AniNovel',
    'パスワード再設定 — AniNovel': 'Reset your password — AniNovel',
    '作者登録の申請 — AniNovel': 'Apply to become a writer — AniNovel',
    'ポイント — AniNovel': 'Points — AniNovel',
    // 題名を変えたら、ここにも足すこと。足し忘れるとタブだけ日本語で残る。
    // (2026-10-19 トップページの題名を変えたのに足しておらず、実際そうなっていた。)
    'アニノベル｜青空文庫の名作を、アニメ風の吹き出しと朗読で読む':
      'AniNovel | Japanese classics read in anime-style speech bubbles',
    'アニノベル - アニメ風吹き出しで読むオリジナル小説プラットフォーム':
      'AniNovel — Original fiction read in anime-style speech bubbles',
    'アニノベル - 作品ビューワ': 'AniNovel — Reader',
    '作品を書く方へ — AniNovel': 'For writers — AniNovel',
    'アニノベル': 'AniNovel'
  };
  /* ------------------------------------------------------------------
   * 画面ごとの追加辞書と、つなぎ合わせた文の置き換え
   * ------------------------------------------------------------------
   * 2026-10-20 追加。
   *
   * なぜ要るのか
   *   管理画面のように、その画面でしか出ない言葉が数百ある画面がある。
   *   それを上の JA2EN に全部書くと、トップページを開く読者にも
   *   管理画面の語を読み込ませることになる。画面ごとに分ける。
   *
   *   もうひとつ。「該当 12 件」のように数を挟んで組み立てる文は、
   *   丸ごと一致では当たらない。断片の表を別に持ち、長い順に当てる。
   *   作品名や人の名前を書き換えないよう、1〜2文字の普通名詞は
   *   断片の表に入れないこと（「件」「分」「作者」など単体は危険）。
   *
   * 使い方（その画面の script を i18n.js より前に置く）
   *   window.ANINOVEL_I18N_EXTRA = {
   *     text:  { '審査待ち': 'Awaiting review' },     // 丸ごと一致
   *     frag:  { ' 件が公開されています。': ' works are published.' },
   *     rx:    [['([0-9]) *件', '$1 items']],        // 数のあとの単位
   *     title: { '作者登録の承認 — AniNovel': 'Approvals — AniNovel' }
   *   };
   *
   *   rx は「数のあとの単位」のように、前後を見ないと危ない語のため。
   *   「件」「円」を断片の表に入れると、作品名の中の同じ字まで
   *   書き換えてしまう。数が前にあるときだけ当てる。
   * 後から足すときは AninovelI18n.extend(同じ形) を呼ぶ。
   */
  var FRAG = {};
  var FRAG_KEYS = [];
  var RX = [];        // [RegExp, 置き換える文字] の並び
  function _rebuildFragKeys(){
    FRAG_KEYS = Object.keys(FRAG).sort(function(a,b){ return b.length - a.length; });
  }
  // かな・漢字のほか、全角の記号 (／ 。 「 」 など) も対象にする。
  // 「A ／ B」のように、かなを含まない塊も直す必要があるため。
  var _HAS_JA = /[\u3040-\u30ff\u4e00-\u9faf\uff01-\uff60\u3000-\u303f]/;

  /** 丸ごと一致で引けない文を、断片ごとに置き換える。 */
  function trFrag(str){
    var t = '' + str;
    if(!FRAG_KEYS.length && !RX.length) return str;
    if(!_HAS_JA.test(t)) return str;
    for(var i=0;i<FRAG_KEYS.length;i++){
      var k = FRAG_KEYS[i];
      if(t.indexOf(k) >= 0) t = t.split(k).join(FRAG[k]);
    }
    // 長い断片を当てたあとに、数のあとの単位を当てる。順番が逆だと
    // 「12 件が公開されています。」の「件」だけが先に化ける。
    for(var j=0;j<RX.length;j++) t = t.replace(RX[j][0], RX[j][1]);
    return t;
  }

  /** 丸ごと一致 → 断片、の順に引く。いまの言語が日本語なら何もしない。 */
  function trFull(str){
    if(currentLang !== 'en') return str;
    var k = String(str).trim();
    var hit = JA2EN[k];
    if(hit && hit !== k) return String(str).replace(k, hit);
    return trFrag(str);
  }

  function extend(obj){
    if(!obj || typeof obj !== 'object') return;
    try{
      if(obj.text) for(var a in obj.text) if(Object.prototype.hasOwnProperty.call(obj.text,a)) JA2EN[a] = obj.text[a];
      if(obj.title) for(var b in obj.title) if(Object.prototype.hasOwnProperty.call(obj.title,b)) DOC_TITLE_EN[b] = obj.title[b];
      if(obj.frag){
        for(var c in obj.frag) if(Object.prototype.hasOwnProperty.call(obj.frag,c)) FRAG[c] = obj.frag[c];
        _rebuildFragKeys();
      }
      if(obj.rx && obj.rx.length){
        for(var d=0;d<obj.rx.length;d++){
          var pair = obj.rx[d];
          if(!pair || pair.length < 2) continue;
          try{ RX.push([new RegExp(pair[0], 'g'), String(pair[1])]); }catch(e){}
        }
      }
    }catch(e){}
  }
  try{ if(window.ANINOVEL_I18N_EXTRA) extend(window.ANINOVEL_I18N_EXTRA); }catch(e){}

  function applyDocTitle(){
    try{
      var b=document.body; if(!b)return;
      if(!b.getAttribute('data-title-ja'))b.setAttribute('data-title-ja',document.title);
      var ja=b.getAttribute('data-title-ja');
      var want=(currentLang==='en'&&DOC_TITLE_EN[ja])?DOC_TITLE_EN[ja]:ja;
      if(document.title!==want)document.title=want;
    }catch(e){}
  }

  // requestAnimationFrame は、背面のタブなどで実行されないことがある。
  // それに任せきりだと _scheduled が立ったままになり、監視が永久に死ぬ。
  // (2026-10-19 実際にそうなり、ログイン画面の案内が日本語のまま残った。)
  // どちらか早い方で必ず一度だけ走らせる。
  function _soon(fn){
    var done=false;
    var run=function(){ if(done)return; done=true; fn(); };
    try{ requestAnimationFrame(run); }catch(e){}
    setTimeout(run,50);
  }
  var _applying=false;
  var _dirty=false;   // 変換している間に届いた描画があるか
  function applyToDOM(){
    if(_applying){_dirty=true;return;} // MutationObserver無限ループ防止
    _applying=true;
    try{
      document.documentElement.lang=currentLang;
      applyDocTitle();
      document.querySelectorAll('[data-i18n]').forEach(function(el){
        var key=el.dataset.i18n;
        var val=t(key);
        var attr=el.dataset.i18nAttr;
        if(attr){if(el.getAttribute(attr)!==val)el.setAttribute(attr,val);}
        else{if(el.textContent!==val)el.textContent=val;}
      });
    }finally{
      // 自分が起こしたMutationが届く前に待ってから解除
      autoTranslateDOM(document.body);
      // 目隠しを外す。これを呼ぶ者が誰もおらず、英語の訪問者は 6 秒の
      // タイマーが切れるまで真っ白な画面を見ていた (2026-10-19 に判明)。
      // 訳し終えた直後がいちばん早く出せる頃合い。
      try{ if(typeof window.__i18nReveal==='function'){ window.__i18nReveal(); } }catch(e){}
      setTimeout(function(){
        _applying=false;
        // 変換している間にポータルが描き直した分は、監視側で捨てられている。
        // 印が立っていたら、もう一度だけ走らせて拾い直す。これが無いと
        // 描画と変換が重なったときに日本語が残り続ける。
        if(_dirty){_dirty=false;_soon(applyToDOM);}
      },0);
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
      if(_applying||_scheduled){_dirty=true;return;}
      // 新しく追加された要素に data-i18n が含まれている場合のみ再適用
      var hasI18n=muts.some(function(m){
        // 既存の要素の文字が書き換わった場合。childList だけ見ていたので
        // textContent='…' のような書き換えに気づかず、ログイン直後の
        // 「ログインしました。移動します…」などが日本語のまま出ていた。
        if(currentLang==='en'&&m.type==='characterData')return true;
        for(var i=0;i<m.addedNodes.length;i++){
          var n=m.addedNodes[i];
          if(currentLang==='en'&&n.nodeType===1)return true;if(n.nodeType===1&&(n.matches&&(n.matches('[data-i18n]')||n.querySelector('[data-i18n]'))))return true;
          if(currentLang==='en'&&n.nodeType===3)return true;
        }
        return false;
      });
      if(!hasI18n)return;
      _scheduled=true;
      _soon(function(){_scheduled=false;applyToDOM();});
    });
    // まだ <html> すら無い時点で呼ばれると、observe は例外を投げる。
    // このファイルは1つのかたまりなので、ここで落ちると
    // AninovelI18n ごと作られず、画面が丸ごと日本語のまま残る。
    // (2026-10-20 管理画面の読み込み順を確かめていて気づいた。)
    var target = document.body || document.documentElement;
    if(!target){
      document.addEventListener('DOMContentLoaded', function(){
        try{ obs.observe(document.body||document.documentElement,
                         {childList:true,subtree:true,characterData:true}); }catch(e){}
      });
      return;
    }
    try{ obs.observe(target,{childList:true,subtree:true,characterData:true}); }catch(e){}
  }

  window.AninovelI18n={
    t:t,
    setLang:setLang,
    getLang:function(){return currentLang;},
    apply:applyToDOM,
    SUPPORTED:SUPPORTED,
    renderSwitcher:renderSwitcher,
    // 日本語の一文を、いまの言語に直して返す。ページ側が文字を画面に
    // 出す直前に呼べば、日本語が一瞬でも見えることがない。
    text:function(ja){
      if(currentLang!=='en')return ja;
      var hit=JA2EN[String(ja).trim()];
      return hit||ja;
    },
    // 丸ごと一致で引けないときは断片で引く。alert の文など、数や
    // 作品名を挟んで組み立てた文はこちらを使う。
    textFull:trFull,
    // 画面ごとの追加辞書を足す。i18n.js を読んだあとでも呼べる。
    extend:function(obj){ extend(obj); try{ applyToDOM(); }catch(e){} }
  };
  window.__ANINOVEL_I18N_VER__='i18n_v10_skip_script';console.info('[i18n] 言語=',currentLang);
})();
