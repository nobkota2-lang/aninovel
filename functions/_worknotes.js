/**
 * 作品紹介ページの中身  functions/_worknotes.js
 * ======================================================================
 * 2026-10-06 作成。
 *
 * なぜこれが要るのか
 * ----------------------------------------------------------------------
 * 公開中の12作品のうち11作が青空文庫で、文字数では99.6%が他所にも存在する
 * 文章になっている。アニノベルの値打ち(吹き出し・話者・声・英訳)は本物だが、
 * 検索エンジンにも AdSense の審査にも、テキストとして見えるものしか届かない。
 * そこで、どこにも存在しない文章をここに置く。
 *
 * 書き方の約束
 * ----------------------------------------------------------------------
 * intro は Claude が下書きしたものです。12件すべて、日英ともに
 * 2段落で完成しています。
 *
 * 2026-11-05: それまで各 intro の末尾に【要加筆】という欄を置き、
 *   「声の選び方」「思いついたきっかけ」などを Nobby さんに書いて
 *   もらう前提にしていた。全部外した。読めば分かるとおり、紹介文
 *   としては欄が無くても閉じていて、読者は欄の不在に気づかない。
 *   欄があるのは Claude が「書いてほしいこと」を課題の形にしたから
 *   で、紹介文の穴ではなかった。「要」を付けたのが行き過ぎだった。
 *   欄は publicText() が切り落としていたので、読者には元から
 *   見えておらず、外しても公開される文章は1文字も変わっていない。
 *
 *   後書きとして声の選び方を書きたくなったら、intro の末尾に普通の
 *   段落として足せばよい。空の欄を置いて待つ作りには戻さないこと。
 *
 * lead は冒頭の引用です。いずれも著作権の切れた作品からの短い引用です。
 * source の底本・入力者・校正者は、2026-11-04 に Nobby さんから
 * 青空文庫の奥付をいただき、12件すべて記入済みです。校正者が複数いる
 * 作品(『吾輩は猫である』の6名)は、担当章まで奥付どおりに並べています。
 * ボランティアの名前は短縮しないこと。出どころを明示してあることが、
 * 「よそから集めてきただけのサイト」ではないという一番分かりやすい証拠に
 * なります。
 *
 * 突き合わせの鍵
 * ----------------------------------------------------------------------
 * id がカタログの作品IDと一致した行が使われます。id が無いときだけ
 * title で突き合わせます (_middleware.js の workIntroPage / introListPage、
 * _worknotes.js の findNote)。
 *
 * 2026-11-05: 全12件に id を入れた。それまでは title だけで繋がっていて、
 *   『坊ちゃん』を正式表記の『坊っちゃん』に直したとき、カタログ側が
 *   まだ『坊ちゃん』だったため突き合わせが外れ、紹介ページが 404 になり、
 *   作品一覧からも落ちた。題名を直すと紹介ページが消えるという作りだった。
 *   この注意書きは事故の前からここに書いてあったのに、読まずに題名を
 *   変えた。警告を書き足すだけでは同じことが起きるので、題名に依存しない
 *   形にした。
 *   以後、作品を追加するときは id も入れること。title での突き合わせは
 *   古い行のための保険として残してあるだけで、新しい行では頼らない。
 */

export const WORK_NOTES = [

  // ====================================================================
  // オリジナル作品
  // ====================================================================
  {
    slug: 'jukkai-kara-tobioriru-businesswoman',
    id: 'pub_owner_bizwoman',
    titleEn: 'The Businesswoman Who Jumps from the Tenth Floor',
    authorEn: 'Nobby',
    leadEn: 'She stepped off the roof of a ten-storey building without the '
          + 'slightest hesitation \u2014 just took a single step, as though she '
          + 'were walking down a staircase.',
    introEn: 'A businesswoman in a black suit steps off the edge of a tenth-floor '
           + 'roof. Aimi, who saw it happen, goes to the parapet braced for the '
           + 'worst and finds the woman walking calmly along the street below. '
           + 'That is where the story starts, and Masaru refuses to believe a word '
           + 'of it. Ten storeys, thirty metres, a spine you never walk on again \u2014 '
           + 'he has the numbers ready before she can finish.\n\n'
           + 'Almost all of it is the two of them talking. No narrator steps in to '
           + 'explain the science; it arrives through one friend wearing the other '
           + 'down, and the sceptic asks exactly the questions a reader would. '
           + 'Speech bubbles are not a layer added on top of this story. They are '
           + 'the shape it already had.\n\n'
           + '\u3010Add where the idea came from, and how you chose the two voices.\u3011',
    title: '10階から飛び降りるビジネスウーマン',
    author: 'Nobby',
    kind: 'original',
    year: '',
    source: '',
    lead: '10階建ての建物の屋上から何のためらいもなく、'
        + '靴を脱いで揃えるわけでもなく、まるで階段を降りるかのように'
        + '一歩踏み出したんだよ！',
    intro:
      '黒いスーツのビジネスウーマンが、十階の屋上の端から一歩踏み出す。' +
      'それを見ていた愛美が、潰れた死体を見る覚悟で下を覗くと、' +
      'その人は平然と下の道を歩いている。そこから話が始まります。' +
      'まさるは信じません。十階、三十メートル、普通なら即死だと、' +
      '数字を並べて反論します。\n\n' +
      'ほとんど全部が二人の会話です。語り手が出てきて説明することはなく、' +
      '疑う側と解き明かす側のやりとりだけで話が進みます。' +
      'まさるが訊くことは、読者が訊きたいことと同じです。' +
      'この作品にとって吹き出しは、後から足した見せ方ではなく、' +
      'もとからの形です。',
  },

  // ====================================================================
  // 青空文庫シリーズ
  // ====================================================================
  {
    slug: 'hashire-merosu',
    id: 'pub_dazai_hashiremerosu',
    titleEn: 'Run, Melos!',
    authorEn: 'Osamu Dazai',
    leadEn: 'Melos was furious. He resolved that he must remove this king, this man of wicked cunning and violence.',
    introEn: 'The opening line has already set the story running. Melos, a shepherd, loses his temper with a king who has stopped believing anyone, and is given three days on the condition that his closest friend stands as hostage. Miss the deadline and the friend dies. That is the whole plot.\n\nIt is short, and most of it is spoken aloud by people whose identity is never in doubt. Read in speech bubbles, the panic of Melos and the silence of the friend waiting for him sit side by side in a way that plain prose tends to smooth over. With voices it is sharper still.',
    title: '走れメロス',
    author: '太宰 治',
    kind: 'aozora',
    year: '1940年',
    source: '青空文庫（底本「太宰治全集3」ちくま文庫、筑摩書房 1988年／入力 金川一之／校正 高橋美奈子）',
    lead: 'メロスは激怒した。必ず、かの邪智暴虐の王を除かなければならぬと決意した。',
    intro:
      '冒頭の一行だけで、もう物語が走り出しています。羊飼いのメロスが、' +
      '人を信じられなくなった王に腹を立て、親友を人質に置いて三日の猶予を' +
      'もらう。期限までに戻らなければ友が死ぬ。それだけの筋書きです。\n\n' +
      '短い作品ですが、会話の分量が多く、しかも誰が喋っているかが' +
      'はっきりしています。吹き出しで読むと、メロスの焦りと、' +
      '待たされ続けるセリヌンティウスの沈黙が、地の文で読むときより' +
      '生々しく迫ってきます。声を当てるとなおさらです。',
  },
  {
    slug: 'chumon-no-oi-ryoriten',
    id: 'pub_miyazawa_chumon_jo',
    titleEn: 'The Restaurant of Many Orders',
    authorEn: 'Kenji Miyazawa',
    leadEn: 'Two young gentlemen, got up exactly like English soldiers, with glittering rifles on their shoulders and two dogs like white bears at their heels, were walking deep in the mountains.',
    introEn: 'Two gentlemen, lost in the mountains, come upon a handsome Western restaurant. Each door they pass carries a new instruction. Comb your hair. Scrape the mud from your boots. Rub this cream on your face. They do as they are told, and only slowly begin to wonder why.\n\nThe story is driven by writing on doors. In an ordinary book those notices sit buried in the prose; here each one arrives on its own, in its own bubble, at the pace the gentlemen read it. You work it out exactly when they do.',
    title: '注文の多い料理店',
    author: '宮沢 賢治',
    kind: 'aozora',
    year: '1924年',
    source: '青空文庫（底本「注文の多い料理店」新潮文庫、新潮社 1990年／入力 土屋隆／校正 noriko saito）',
    lead: '二人の若い紳士が、すっかりイギリスの兵隊のかたちをして、' +
          'ぴかぴかする鉄砲をかついで、白熊のような犬を二疋つれて、' +
          'だいぶ山奥の、木の葉のかさかさしたとこを、こんなことを' +
          '云いながら、あるいておりました。',
    intro:
      '山奥で道に迷った二人の紳士が、立派な西洋料理店を見つけます。' +
      '扉をくぐるたびに新しい注文書きが現れる。髪をとかせ、靴の泥を落とせ、' +
      '壺のクリームを塗れ。言われるままに従ううち、何かがおかしいと' +
      '気づきはじめます。\n\n' +
      'この作品は、扉に書かれた文字そのものが物語を進めます。' +
      '本来なら地の文に埋もれてしまうその一枚一枚を、' +
      '吹き出しとして一つずつ見せられるのは、この形式ならではだと思います。' +
      '読者が紳士たちと同じ速さで気づいていく感覚を、ぜひ味わってください。',
  },
  {
    slug: 'oshie-to-tabisuru-otoko',
    id: 'pub_ranpo_oshie',
    titleEn: 'The Traveler with the Pasted Rag Picture',
    authorEn: 'Edogawa Rampo',
    leadEn: '',
    introEn: 'On the train home from watching a mirage at Uozu, the narrator shares a carriage with a strange man carrying a framed picture made of pasted cloth. In it are an old man and a young woman. The old man, he says, is his brother.\n\nOf all Rampo wrote, this is the one where beauty outweighs horror. A man tells a story, and inside that story another time opens up. Keeping the frames apart by speaker makes it much easier to hold on to whose memory you are inside at any moment.',
    title: '押絵と旅する男',
    author: '江戸川 乱歩',
    kind: 'aozora',
    year: '1929年',
    source: '青空文庫（底本「江戸川乱歩全集 第5巻 押絵と旅する男」光文社文庫、光文社 2005年／入力 砂場清隆／校正 門田裕志）',
    lead: 'この話を、私が夢で見たのか、それとも私の一時的狂気の幻影であったのか、' +
          'いずれにしても、私は夢を見る性質ではないし、……',
    intro:
      '魚津へ蜃気楼を見に行った帰りの汽車で、「私」は奇妙な男と乗り合わせます。' +
      '男が大事そうに抱えた押絵には、老人と若い娘が描かれている。' +
      'その老人は、男の兄だというのです。\n\n' +
      '乱歩の作品のなかでも、怖さより美しさが勝つ一編です。' +
      '語り手が聞き、男が語り、その語りのなかにまた別の時間が開く。' +
      '入れ子になった語りを、話し手ごとに吹き出しで分けて読むと、' +
      'どこから誰の記憶なのかが見失われずに済みます。',
  },
  {
    slug: 'rashomon',
    id: 'pub_akutagawa_rashomon',
    titleEn: 'Rashōmon',
    authorEn: 'Ryūnosuke Akutagawa',
    leadEn: 'It was evening, and a servant was waiting under the Rashōmon gate for the rain to stop.',
    introEn: 'A servant, dismissed and with nowhere to go, shelters from the rain under the ruined Rashōmon gate. Climbing to the upper floor he finds an old woman pulling hair from the dead. Challenged, she explains herself, and her explanation is what decides what he does next.\n\nMany Japanese readers meet this story at school. Hearing the exchange spoken changes it. The old woman is oddly persuasive, and that persuasiveness is exactly what the servant turns back on her. Following it in bubbles makes the turn easy to see.',
    title: '羅生門',
    author: '芥川 龍之介',
    kind: 'aozora',
    year: '1915年',
    source: '青空文庫（底本「芥川龍之介全集1」ちくま文庫、筑摩書房 1986年／入力 平山誠・野口英司／校正 もりみつじゅんじ）',
    lead: 'ある日の暮方の事である。一人の下人が、羅生門の下で雨やみを待っていた。',
    intro:
      '職を失った下人が、荒れ果てた羅生門の下で雨宿りをしています。' +
      '楼の上にのぼると、死体から髪を抜いている老婆がいた。' +
      '咎める下人に、老婆は自分なりの理屈を述べます。' +
      'その理屈を聞いた下人が、次に何をするか。\n\n' +
      '教科書で読んだという方が多いと思います。' +
      'ただ、下人と老婆のやりとりを声に出して聞くと、' +
      '印象がかなり変わります。老婆の言い分には妙な説得力があり、' +
      'それがそのまま下人の行動に跳ね返っていく。' +
      'その流れが、吹き出しで追うとよく見えます。',
  },
  {
    slug: 'yuki-onna',
    id: 'pub_hearn_yukionna',
    // 英訳の出どころについて。本文の日本語は田部隆次の訳で、原文は
    // ハーンが英語で書いたもの。いまの英訳はその日本語訳からの再訳に
    // なっていて、ハーン自身の英語ではない。原文は著作権が切れている
    // ので、本来はそちらを使うのが正しい。紹介文にその旨を書くか、
    // 本文の英訳を原文に差し替えるかは未決。
    titleEn: 'Yuki-onna (The Snow Woman)',
    authorEn: 'Lafcadio Hearn',
    leadEn: '',
    introEn: 'Caught in a blizzard, two woodcutters shelter in a ferryman\'s hut. The younger, Minokichi, wakes to find a woman in white breathing over his sleeping companion. She spares him on one condition: that he never tell anyone what he saw. Years later, on an ordinary evening, he breaks his word.\n\nThe story is as Japanese as snow country gets, and it was written by a man born in Greece. Hearn collected it for Kwaidan in 1904, and the English you are reading here is closer to the source than the Japanese is.',
    title: '雪女',
    author: '小泉 八雲',
    kind: 'aozora',
    year: '1904年',
    source: '青空文庫（底本「小泉八雲全集第八卷 家庭版」第一書房 1937年／訳 田部隆次／入力 京都大学電子テクスト研究会入力班（大石尺）／校正 京都大学電子テクスト研究会校正班（大久保ゆう））',
    lead: '武蔵の国のある村に、茂作、巳之吉と云う二人の樵夫がいた。',
    intro:
      '吹雪の晩、渡し守の小屋に閉じ込められた二人の樵。' +
      '若い巳之吉が目を覚ますと、白い女が老いた茂作に息を吹きかけていました。' +
      '女は巳之吉を見逃すかわりに、今夜のことを誰にも話すなと言い残して消えます。' +
      '何年も経ったある晩、巳之吉はその約束を破ってしまう。\n\n' +
      '日本の雪国の話でありながら、書いたのはギリシャ生まれの小泉八雲です。' +
      '日本語で読んでいるものは訳文で、その経緯も含めて面白い一編だと思います。' +
      '語りの静けさと、短い台詞の重さの落差が、声にすると際立ちます。',
  },
  {
    slug: 'ginga-tetsudo-no-yoru',
    id: 'pub_1783235234183',
    titleEn: 'Night on the Galactic Railroad',
    authorEn: 'Kenji Miyazawa',
    leadEn: '',
    introEn: 'Giovanni, a boy with too much work and too little money, finds himself aboard a train crossing the Milky Way. Campanella, his friend, is in the next seat. They follow the stars from station to station, talking with the passengers who come and go, until they reach a parting.\n\nMiyazawa revised this all his life and never finished it, and perhaps that is why it stays with readers as a series of places rather than a plot. There are many voices, and they change quickly, which is precisely the situation speech bubbles were made for.',
    title: '銀河鉄道の夜',
    author: '宮沢賢治',
    kind: 'aozora',
    year: '1934年（没後発表）',
    yearEn: '1934 (published posthumously)',
    source: '青空文庫（底本「新編 銀河鉄道の夜」新潮文庫、新潮社 1989年／入力 中村隆生・野口英司／校正 野口英司）',
    lead: '「ではみなさんは、そういうふうに川だと云われたり、' +
          '乳の流れたあとだと云われたりしていたこのぼんやりと白いものが' +
          'ほんとうは何かご承知ですか。」',
    intro:
      '貧しい少年ジョバンニが、気づくと銀河をめぐる汽車に乗っています。' +
      '隣には親友のカムパネルラ。二人は星をたどりながら、' +
      '次々と現れる乗客と言葉を交わし、やがて別れを迎えます。\n\n' +
      '賢治が生涯手を入れ続け、完成を見ないまま遺した作品です。' +
      'だからでしょうか、筋を追うより、場面ごとの手ざわりが記憶に残ります。' +
      '登場人物が多く、しかも入れ替わりが早いので、' +
      '誰の言葉かを吹き出しで示せるこの形式とは相性がよいと感じています。',
  },
  {
    slug: 'wagahai-wa-neko-de-aru',
    id: 'pub_1783638840104',
    titleEn: 'I Am a Cat',
    authorEn: 'Sōseki Natsume',
    leadEn: 'I am a cat. As yet I have no name.',
    introEn: 'A nameless cat takes up residence with Kushami, a schoolmaster of English, and watches the people who drift through the house. Meitei the aesthete, Kangetsu the physicist, Tōfū the poet. They gather, they argue about nothing in particular at enormous length, and the cat reviews their performance. That is the book, for several hundred pages.\n\nThere is almost no plot and almost nothing but talk, which makes it one of the best possible fits for this format. Simply knowing at a glance who is speaking makes those long conversations far easier to stay inside.\n\nIt is the longest work on the site. Use the bookmark and take your time.',
    title: '吾輩は猫である',
    author: '夏目漱石',
    kind: 'aozora',
    year: '1905〜1906年',
    source: '青空文庫（底本「夏目漱石全集1」ちくま文庫、筑摩書房 1987年／入力 柴田卓治／校正 渡部峰子（一）、おのしげひこ（二、五）、田尻幹二（三）、高橋真也（四、七、八、十、十一）、しず（六）、瀬戸さえ子（九））',
    lead: '吾輩は猫である。名前はまだ無い。',
    intro:
      '名前のない猫が、英語教師・珍野苦沙弥の家に住み着き、' +
      'そこに出入りする人間たちを見物します。' +
      '美学者の迷亭、理学者の寒月、詩人の東風。' +
      '彼らが集まっては他愛のない議論を延々と続ける、その様子を猫が論評する。' +
      'それだけの作品が、文庫で何百ページも続きます。\n\n' +
      '筋らしい筋がなく、ほとんどが会話で成り立っています。' +
      '裏を返せば、吹き出しで読むのに最も向いた作品のひとつです。' +
      '誰が何を言っているかが一目で分かるだけで、' +
      'あの長い座談がぐっと追いやすくなります。' +
      '当サイトで最も長い作品ですので、しおりを使ってゆっくりどうぞ。',
  },
  {
    slug: 'bocchan',
    id: 'pub_1784799247248',
    titleEn: 'Botchan',
    authorEn: 'Sōseki Natsume',
    leadEn: 'Ever since I was a child, the recklessness I inherited from my parents has brought me nothing but trouble.',
    introEn: 'A headstrong Tokyoite takes a post teaching mathematics at a middle school in Shikoku. Redshirt, Clown, Porcupine, Hubbard Squash: he hands out nicknames, and then collides with every one of them, telling the whole thing himself at speed.\n\nBecause it is all in one voice from beginning to end, it suits narration unusually well. Lines that run away with you on the page turn comic when they are spoken. Watching that cast of nicknames line up in bubbles is its own pleasure.',
    title: '坊っちゃん',
    author: '夏目漱石',
    kind: 'aozora',
    year: '1906年',
    source: '青空文庫（底本「ちくま日本文学全集 夏目漱石」筑摩書房 1992年／入力 真先芳秋／校正 柳沢成雄）',
    lead: '親譲りの無鉄砲で小供の時から損ばかりしている。',
    intro:
      '無鉄砲な江戸っ子が、四国の中学校へ数学教師として赴任します。' +
      '赤シャツ、野だいこ、山嵐、うらなり。' +
      '勝手にあだ名をつけた同僚たちとの衝突が、一人称でまくし立てられていきます。\n\n' +
      '最初から最後まで「坊っちゃん」の声で語られる作品なので、' +
      '読み上げとの相性がとてもよいです。' +
      '書き言葉で読むと勢いに押される箇所が、声になるとかえって' +
      'おかしみに変わります。あだ名で呼ばれる面々が吹き出しで並ぶのも、' +
      'この作品らしい眺めだと思います。',
  },
  {
    slug: 'butai-no-kotoba',
    id: 'pub_1784798976969',
    titleEn: 'Words of the Stage',
    authorEn: 'Kunio Kishida',
    leadEn: '',
    introEn: 'The playwright Kunio Kishida on the words that are spoken on a stage: what happens to a written line once it passes through an actor, and how the speech of a play differs from the speech of a room.\n\nThis is not fiction. It is an essay about language itself, which makes it an odd and slightly pointed thing to find on a site that puts lines in bubbles and reads them aloud. Come to it after a few of the stories and it reads differently.',
    title: '舞台の言葉',
    author: '岸田國士',
    kind: 'aozora',
    year: '',
    source: '青空文庫（底本「日本の名随筆70 語」作品社 1988年／入力 大野晋／校正 多羅尾伴内）',
    lead: '',
    intro:
      '劇作家・岸田國士が、舞台の上で話される言葉について書いた一編です。' +
      '書かれた台詞が俳優の口を通ったとき何が起こるのか、' +
      '日常の言葉と舞台の言葉はどう違うのか。\n\n' +
      '小説ではなく、言葉そのものを論じた文章です。' +
      'ただ、台詞を吹き出しで見せ、声で読ませるアニノベルにとっては、' +
      'いわば足元を問い直される内容でもあります。' +
      'ほかの作品を何編か読んだあとに手に取ると、' +
      '見え方が変わるかもしれません。',
  },
  {
    slug: 'kido-mukashigatari',
    id: 'pub_1784818723945',
    // titleEn は機械翻訳の "Good old talk." を Claude が差し替えた案。
    // Nobby さんの確認を経ていない。変えるなら、カタログ側の titleEn も
    // 合わせること(/api/catalog の行にも入っている)。
    titleEn: 'Kidō\'s Tales of Times Past',
    authorEn: 'Kidō Okamoto',
    leadEn: '',
    introEn: 'Kidō Okamoto, best known for the Hanshichi detective stories, remembering the Tokyo he grew up in as it turned from Edo into Meiji. The smell of the streets, the noise of the theatres, fires, earthquakes. Not invented: recorded.\n\nIt is the second longest work here, and it rewards dipping in at whatever chapter catches your eye rather than reading straight through. The voice is unhurried, which makes it good listening.',
    title: '綺堂むかし語り',
    author: '岡本綺堂',
    kind: 'aozora',
    year: '',
    source: '青空文庫（底本「綺堂むかし語り」光文社時代小説文庫、光文社 1995年／入力 tatsuki・『鳩よ！』編集部／校正 松永正敏）',
    lead: '',
    intro:
      '『半七捕物帳』で知られる岡本綺堂が、' +
      '自分の見聞きした江戸から明治へのうつり変わりを綴った随筆集です。' +
      '町の匂い、芝居小屋のにぎわい、火事、地震。' +
      '作り話ではなく、そこにあったものの記録です。\n\n' +
      '当サイトで二番目に長い作品で、通して読むというより、' +
      '気になった章から拾い読みするのに向いています。' +
      '語り口が穏やかなので、読み上げで聞き流すのもよいと思います。',
  },
  {
    slug: 'ai-to-bi-ni-tsuite',
    id: 'pub_1784820001168',
    titleEn: 'On Love and Beauty',
    authorEn: 'Osamu Dazai',
    leadEn: '',
    introEn: 'Five siblings take turns carrying a single story forward. The eldest brother is solemn and theoretical, the second affects sophistication, the sister tells it her way. The cast stays the same and the tale bends a little further out of shape with every handover. The bending is the point.\n\nWith five narrators, seeing at a glance which one has the floor does a great deal of work. It is also Dazai in a bright and funny mood, which surprises people who only know him by reputation.',
    title: '愛と美について',
    author: '太宰治',
    kind: 'aozora',
    year: '1939年',
    source: '青空文庫（底本「新樹の言葉」新潮文庫、新潮社 1982年／入力 田中久太郎／校正 鈴木厚司）',
    lead: '',
    intro:
      '五人きょうだいが、ひとつの物語を順番に語り継いでいきます。' +
      '長男は理屈っぽく、次男は気取り、妹は妹なりに。' +
      '同じ登場人物の話なのに、語り手が替わるたびに話が勝手に捻じ曲がっていく。' +
      'そのずれ方そのものが読みどころです。\n\n' +
      '語り手が五人いる作品ですから、' +
      '誰が語っているかが見た目で分かることの効き目が大きい一編です。' +
      '太宰にしては明るく、ユーモアのある作品でもあります。',
  }
];

/** 作品名、または id で紹介文を探す。 */
export function findNote(work) {
  if (!work) return null;
  for (const n of WORK_NOTES) {
    if (n.id && work.id && n.id === work.id) return n;
  }
  for (const n of WORK_NOTES) {
    if (n.title && work.title && n.title === work.title) return n;
  }
  return null;
}

/** スラッグから紹介文を探す。 */
export function noteBySlug(slug) {
  return WORK_NOTES.find((n) => n.slug === slug) || null;
}

/** 中身が書けている紹介文だけ。空のものはページを作らない。 */
export function readyNotes() {
  return WORK_NOTES.filter((n) => n.intro && n.intro.trim().length > 0);
}
