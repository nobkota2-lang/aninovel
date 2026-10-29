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
 * intro は Claude が下書きしたものです。**そのまま使わないでください。**
 * あらすじだけなら他所にもあります。値打ちが出るのは、
 *   ・なぜこの作品を選んだのか
 *   ・登場人物に誰の声をどう当てたのか、なぜそうしたのか
 *   ・読むときにどこを見てほしいのか
 * といった、Nobby さんにしか書けない部分です。各 intro の末尾に
 * 【要加筆】として場所を空けてあります。そこを埋め、前半も自分の言葉に
 * 直してから公開してください。
 *
 * lead は冒頭の引用です。いずれも著作権の切れた作品からの短い引用です。
 * source の底本・入力者・校正者は、お手元の青空文庫ファイルで確かめて
 * 書き足してください(【要確認】のところ)。出どころを明示してあることが、
 * 「よそから集めてきただけのサイト」ではないという一番分かりやすい証拠に
 * なります。
 *
 * 突き合わせの鍵
 * ----------------------------------------------------------------------
 * title がカタログの作品名と一致した行が使われます。id を書けばそちらが
 * 優先されます。作品名を変える予定があるなら、id を入れておくのが安全です。
 */

export const WORK_NOTES = [

  // ====================================================================
  // オリジナル作品
  // ====================================================================
  {
    slug: 'jukkai-kara-tobioriru-businesswoman',
    titleEn: '',
    authorEn: 'Nobby',
    leadEn: '',
    introEn: '',
    title: '10階から飛び降りるビジネスウーマン',
    author: 'Nobby',
    kind: 'original',
    year: '',
    source: '',
    lead: '',
    // 【全面的に要執筆】ここは Claude には書けません。作品の中身を知らないためです。
    // 読んだ人に何を持ち帰ってほしいか、どこから書き始めたか、
    // 登場人物の声をどう決めたかを、300〜500字でお願いします。
    intro: ''
  },

  // ====================================================================
  // 青空文庫シリーズ
  // ====================================================================
  {
    slug: 'hashire-merosu',
    titleEn: 'Run, Melos!',
    authorEn: 'Osamu Dazai',
    leadEn: 'Melos was furious. He resolved that he must remove this king, this man of wicked cunning and violence.',
    introEn: 'The opening line has already set the story running. Melos, a shepherd, loses his temper with a king who has stopped believing anyone, and is given three days on the condition that his closest friend stands as hostage. Miss the deadline and the friend dies. That is the whole plot.\n\nIt is short, and most of it is spoken aloud by people whose identity is never in doubt. Read in speech bubbles, the panic of Melos and the silence of the friend waiting for him sit side by side in a way that plain prose tends to smooth over. With voices it is sharper still.\n\n【Add a line about how you cast the three voices, and why this work sits near the front of the catalogue.】',
    title: '走れメロス',
    author: '太宰 治',
    kind: 'aozora',
    year: '1940年',
    source: '青空文庫（底本・入力者・校正者は【要確認】）',
    lead: 'メロスは激怒した。必ず、かの邪智暴虐の王を除かなければならぬと決意した。',
    intro:
      '冒頭の一行だけで、もう物語が走り出しています。羊飼いのメロスが、' +
      '人を信じられなくなった王に腹を立て、親友を人質に置いて三日の猶予を' +
      'もらう。期限までに戻らなければ友が死ぬ。それだけの筋書きです。\n\n' +
      '短い作品ですが、会話の分量が多く、しかも誰が喋っているかが' +
      'はっきりしています。吹き出しで読むと、メロスの焦りと、' +
      '待たされ続けるセリヌンティウスの沈黙が、地の文で読むときより' +
      '生々しく迫ってきます。声を当てるとなおさらです。\n\n' +
      '【要加筆】メロス・セリヌンティウス・ディオニスの声をどう選んだか、' +
      'なぜこの作品を最初のほうに置いたかを、ひとこと。'
  },
  {
    slug: 'chumon-no-oi-ryoriten',
    titleEn: 'The Restaurant of Many Orders',
    authorEn: 'Kenji Miyazawa',
    leadEn: 'Two young gentlemen, got up exactly like English soldiers, with glittering rifles on their shoulders and two dogs like white bears at their heels, were walking deep in the mountains.',
    introEn: 'Two gentlemen, lost in the mountains, come upon a handsome Western restaurant. Each door they pass carries a new instruction. Comb your hair. Scrape the mud from your boots. Rub this cream on your face. They do as they are told, and only slowly begin to wonder why.\n\nThe story is driven by writing on doors. In an ordinary book those notices sit buried in the prose; here each one arrives on its own, in its own bubble, at the pace the gentlemen read it. You work it out exactly when they do.\n\n【Say how you handled the writing on the doors, and how you split the two gentlemen.】',
    title: '注文の多い料理店',
    author: '宮沢 賢治',
    kind: 'aozora',
    year: '1924年',
    source: '青空文庫（底本・入力者・校正者は【要確認】）',
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
      '読者が紳士たちと同じ速さで気づいていく感覚を、ぜひ味わってください。\n\n' +
      '【要加筆】扉の文字をどう表現したか、二人の紳士の声をどう分けたかを。'
  },
  {
    slug: 'oshie-to-tabisuru-otoko',
    titleEn: 'The Man Travelling with the Pasted-Picture',
    authorEn: 'Edogawa Rampo',
    leadEn: '',
    introEn: 'On the train home from watching a mirage at Uozu, the narrator shares a carriage with a strange man carrying a framed picture made of pasted cloth. In it are an old man and a young woman. The old man, he says, is his brother.\n\nOf all Rampo wrote, this is the one where beauty outweighs horror. A man tells a story, and inside that story another time opens up. Keeping the frames apart by speaker makes it much easier to hold on to whose memory you are inside at any moment.\n\n【Add how you separated the narrator from the man, and anything about the dreamlike passages.】',
    title: '押絵と旅する男',
    author: '江戸川 乱歩',
    kind: 'aozora',
    year: '1929年',
    source: '青空文庫（底本・入力者・校正者は【要確認】）',
    lead: 'この話を、私が夢で見たのか、それとも私の一時的狂気の幻影であったのか、' +
          'いずれにしても、私は夢を見る性質ではないし、……',
    intro:
      '魚津へ蜃気楼を見に行った帰りの汽車で、「私」は奇妙な男と乗り合わせます。' +
      '男が大事そうに抱えた押絵には、老人と若い娘が描かれている。' +
      'その老人は、男の兄だというのです。\n\n' +
      '乱歩の作品のなかでも、怖さより美しさが勝つ一編です。' +
      '語り手が聞き、男が語り、その語りのなかにまた別の時間が開く。' +
      '入れ子になった語りを、話し手ごとに吹き出しで分けて読むと、' +
      'どこから誰の記憶なのかが見失われずに済みます。\n\n' +
      '【要加筆】語り手と男の声をどう分けたか。幻想的な場面の見せ方について。'
  },
  {
    slug: 'rashomon',
    titleEn: 'Rashōmon',
    authorEn: 'Ryūnosuke Akutagawa',
    leadEn: 'It was evening, and a servant was waiting under the Rashōmon gate for the rain to stop.',
    introEn: 'A servant, dismissed and with nowhere to go, shelters from the rain under the ruined Rashōmon gate. Climbing to the upper floor he finds an old woman pulling hair from the dead. Challenged, she explains herself, and her explanation is what decides what he does next.\n\nMany Japanese readers meet this story at school. Hearing the exchange spoken changes it. The old woman is oddly persuasive, and that persuasiveness is exactly what the servant turns back on her. Following it in bubbles makes the turn easy to see.\n\n【Add your casting of the servant and the old woman, and what you want a first-time reader to notice.】',
    title: '羅生門',
    author: '芥川 龍之介',
    kind: 'aozora',
    year: '1915年',
    source: '青空文庫（底本・入力者・校正者は【要確認】）',
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
      'その流れが、吹き出しで追うとよく見えます。\n\n' +
      '【要加筆】下人と老婆の配役について。短い作品をどう読ませたいか。'
  },
  {
    slug: 'yuki-onna',
    titleEn: 'Yuki-onna (The Snow Woman)',
    authorEn: 'Lafcadio Hearn',
    leadEn: '',
    introEn: 'Caught in a blizzard, two woodcutters shelter in a ferryman\'s hut. The younger, Minokichi, wakes to find a woman in white breathing over his sleeping companion. She spares him on one condition: that he never tell anyone what he saw. Years later, on an ordinary evening, he breaks his word.\n\nThe story is as Japanese as snow country gets, and it was written by a man born in Greece. Hearn collected it for Kwaidan in 1904, and the English you are reading here is closer to the source than the Japanese is.\n\n【Add how you cast O-Yuki. See also the note I left you about using Hearn\'s own English rather than a translation back from Japanese.】',
    title: '雪女',
    author: '小泉 八雲',
    kind: 'aozora',
    year: '1904年',
    source: '青空文庫（日本語訳の訳者名と底本は【要確認】）',
    lead: '武蔵の国のある村に、茂作、巳之吉と云う二人の樵夫がいた。',
    intro:
      '吹雪の晩、渡し守の小屋に閉じ込められた二人の樵。' +
      '若い巳之吉が目を覚ますと、白い女が老いた茂作に息を吹きかけていました。' +
      '女は巳之吉を見逃すかわりに、今夜のことを誰にも話すなと言い残して消えます。' +
      '何年も経ったある晩、巳之吉はその約束を破ってしまう。\n\n' +
      '日本の雪国の話でありながら、書いたのはギリシャ生まれの小泉八雲です。' +
      '日本語で読んでいるものは訳文で、その経緯も含めて面白い一編だと思います。' +
      '語りの静けさと、短い台詞の重さの落差が、声にすると際立ちます。\n\n' +
      '【要加筆】訳者名を出典に追記してください。お雪の声をどう選んだかも。'
  },
  {
    slug: 'ginga-tetsudo-no-yoru',
    titleEn: 'Night on the Galactic Railroad',
    authorEn: 'Kenji Miyazawa',
    leadEn: '',
    introEn: 'Giovanni, a boy with too much work and too little money, finds himself aboard a train crossing the Milky Way. Campanella, his friend, is in the next seat. They follow the stars from station to station, talking with the passengers who come and go, until they reach a parting.\n\nMiyazawa revised this all his life and never finished it, and perhaps that is why it stays with readers as a series of places rather than a plot. There are many voices, and they change quickly, which is precisely the situation speech bubbles were made for.\n\n【Add how you divided a long work, and how you chose Campanella\'s voice.】',
    title: '銀河鉄道の夜',
    author: '宮沢賢治',
    kind: 'aozora',
    year: '1934年（没後発表）',
    source: '青空文庫（底本・入力者・校正者は【要確認】',
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
      '誰の言葉かを吹き出しで示せるこの形式とは相性がよいと感じています。\n\n' +
      '【要加筆】長編をどう区切ったか。カムパネルラの声をどう決めたか。'
  },
  {
    slug: 'wagahai-wa-neko-de-aru',
    titleEn: 'I Am a Cat',
    authorEn: 'Sōseki Natsume',
    leadEn: 'I am a cat. As yet I have no name.',
    introEn: 'A nameless cat takes up residence with Kushami, a schoolmaster of English, and watches the people who drift through the house. Meitei the aesthete, Kangetsu the physicist, Tōfū the poet. They gather, they argue about nothing in particular at enormous length, and the cat reviews their performance. That is the book, for several hundred pages.\n\nThere is almost no plot and almost nothing but talk, which makes it one of the best possible fits for this format. Simply knowing at a glance who is speaking makes those long conversations far easier to stay inside.\n\nIt is the longest work on the site. Use the bookmark and take your time.\n\n【Add your casting of Kushami, Meitei and Kangetsu, and how you chose to handle 330,000 characters.】',
    title: '吾輩は猫である',
    author: '夏目漱石',
    kind: 'aozora',
    year: '1905〜1906年',
    source: '青空文庫（底本・入力者・校正者は【要確認】）',
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
      '当サイトで最も長い作品ですので、しおりを使ってゆっくりどうぞ。\n\n' +
      '【要加筆】苦沙弥・迷亭・寒月の声をどう当てたか。' +
      '32万字をどう扱うことにしたか。'
  },
  {
    slug: 'bocchan',
    titleEn: 'Botchan',
    authorEn: 'Sōseki Natsume',
    leadEn: 'Ever since I was a child, the recklessness I inherited from my parents has brought me nothing but trouble.',
    introEn: 'A headstrong Tokyoite takes a post teaching mathematics at a middle school in Shikoku. Redshirt, Clown, Porcupine, Hubbard Squash: he hands out nicknames, and then collides with every one of them, telling the whole thing himself at speed.\n\nBecause it is all in one voice from beginning to end, it suits narration unusually well. Lines that run away with you on the page turn comic when they are spoken. Watching that cast of nicknames line up in bubbles is its own pleasure.\n\n【Add how you chose the narrator\'s voice.】',
    title: '坊ちゃん',
    author: '夏目漱石',
    kind: 'aozora',
    year: '1906年',
    source: '青空文庫（底本・入力者・校正者は【要確認】）',
    lead: '親譲りの無鉄砲で小供の時から損ばかりしている。',
    intro:
      '無鉄砲な江戸っ子が、四国の中学校へ数学教師として赴任します。' +
      '赤シャツ、野だいこ、山嵐、うらなり。' +
      '勝手にあだ名をつけた同僚たちとの衝突が、一人称でまくし立てられていきます。\n\n' +
      '最初から最後まで「坊ちゃん」の声で語られる作品なので、' +
      '読み上げとの相性がとてもよいです。' +
      '書き言葉で読むと勢いに押される箇所が、声になるとかえって' +
      'おかしみに変わります。あだ名で呼ばれる面々が吹き出しで並ぶのも、' +
      'この作品らしい眺めだと思います。\n\n' +
      '【要加筆】坊ちゃんの声の選び方について。' +
      'なお、一般には「坊っちゃん」と小さい「っ」を入れる表記が定着しています。' +
      '検索で見つけてもらうためにも、作品名の見直しをご検討ください。'
  },
  {
    slug: 'butai-no-kotoba',
    titleEn: 'Words of the Stage',
    authorEn: 'Kunio Kishida',
    leadEn: '',
    introEn: 'The playwright Kunio Kishida on the words that are spoken on a stage: what happens to a written line once it passes through an actor, and how the speech of a play differs from the speech of a room.\n\nThis is not fiction. It is an essay about language itself, which makes it an odd and slightly pointed thing to find on a site that puts lines in bubbles and reads them aloud. Come to it after a few of the stories and it reads differently.\n\n【This is the one work whose place in the catalogue a reader will not guess. Please say in your own words why it is here.】',
    title: '舞台の言葉',
    author: '岸田國士',
    kind: 'aozora',
    year: '',
    source: '青空文庫（底本・入力者・校正者は【要確認】）',
    lead: '',
    intro:
      '劇作家・岸田國士が、舞台の上で話される言葉について書いた一編です。' +
      '書かれた台詞が俳優の口を通ったとき何が起こるのか、' +
      '日常の言葉と舞台の言葉はどう違うのか。\n\n' +
      '小説ではなく、言葉そのものを論じた文章です。' +
      'ただ、台詞を吹き出しで見せ、声で読ませるアニノベルにとっては、' +
      'いわば足元を問い直される内容でもあります。' +
      'ほかの作品を何編か読んだあとに手に取ると、' +
      '見え方が変わるかもしれません。\n\n' +
      '【要加筆】この一編を入れた理由を、ぜひご自身の言葉で。' +
      'ここは他の作品より、選んだ意図が読者に伝わりにくい一編だと思います。'
  },
  {
    slug: 'kido-mukashigatari',
    titleEn: 'Kidō\'s Tales of Times Past',
    authorEn: 'Kidō Okamoto',
    leadEn: '',
    introEn: 'Kidō Okamoto, best known for the Hanshichi detective stories, remembering the Tokyo he grew up in as it turned from Edo into Meiji. The smell of the streets, the noise of the theatres, fires, earthquakes. Not invented: recorded.\n\nIt is the second longest work here, and it rewards dipping in at whatever chapter catches your eye rather than reading straight through. The voice is unhurried, which makes it good listening.\n\n【Add which chapter you would start someone on. Note: the English title here is my suggestion, replacing the machine-translated "Good old talk." Please confirm or change it.】',
    title: '綺堂むかし語り',
    author: '岡本綺堂',
    kind: 'aozora',
    year: '',
    source: '青空文庫（底本・入力者・校正者は【要確認】）',
    lead: '',
    intro:
      '『半七捕物帳』で知られる岡本綺堂が、' +
      '自分の見聞きした江戸から明治へのうつり変わりを綴った随筆集です。' +
      '町の匂い、芝居小屋のにぎわい、火事、地震。' +
      '作り話ではなく、そこにあったものの記録です。\n\n' +
      '当サイトで二番目に長い作品で、通して読むというより、' +
      '気になった章から拾い読みするのに向いています。' +
      '語り口が穏やかなので、読み上げで聞き流すのもよいと思います。\n\n' +
      '【要加筆】どの章から読むのがおすすめか。随筆をどう構成したか。'
  },
  {
    slug: 'ai-to-bi-ni-tsuite',
    titleEn: 'On Love and Beauty',
    authorEn: 'Osamu Dazai',
    leadEn: '',
    introEn: 'Five siblings take turns carrying a single story forward. The eldest brother is solemn and theoretical, the second affects sophistication, the sister tells it her way. The cast stays the same and the tale bends a little further out of shape with every handover. The bending is the point.\n\nWith five narrators, seeing at a glance which one has the floor does a great deal of work. It is also Dazai in a bright and funny mood, which surprises people who only know him by reputation.\n\n【Add how you shared out the five voices.】',
    title: '愛と美について',
    author: '太宰治',
    kind: 'aozora',
    year: '1939年',
    source: '青空文庫（底本・入力者・校正者は【要確認】）',
    lead: '',
    intro:
      '五人きょうだいが、ひとつの物語を順番に語り継いでいきます。' +
      '長男は理屈っぽく、次男は気取り、妹は妹なりに。' +
      '同じ登場人物の話なのに、語り手が替わるたびに話が勝手に捻じ曲がっていく。' +
      'そのずれ方そのものが読みどころです。\n\n' +
      '語り手が五人いる作品ですから、' +
      '誰が語っているかが見た目で分かることの効き目が大きい一編です。' +
      '太宰にしては明るく、ユーモアのある作品でもあります。\n\n' +
      '【要加筆】五人の声の割り振りについて。'
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
