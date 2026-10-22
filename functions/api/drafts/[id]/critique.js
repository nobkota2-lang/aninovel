/**
 * AIによる講評  /api/drafts/:id/critique
 * ============================================================
 * 2026-10-18 追加、同日 100点法に改訂。
 *
 * 何のためのものか
 *   作者が自分の作品について、読み手がどう受け取るかを知るための道具。
 *   けなすためのものではない。「良い。ここをこうするともっと良くなる」
 *   という形に寄せる。そのために prompt で一般論と見下した語を禁じている。
 *
 * 誰が見られるか
 *   作者本人   … いつでも。作り直しも公開の切り替えも本人だけ。
 *   オーナー   … 作者が公開を依頼した後だけ。審査の判断材料にするため。
 *                 まだ下書きのうちは、オーナーでも開けない。
 *   読者       … 作者が公開を選んだときだけ。既定は非公開。
 *
 * 点数
 *   観点ごとに 0〜100 点。総合はその平均。
 *   総合が PUBLISH_MIN_SCORE 未満のものは公開を認めない (submit.js が使う)。
 *   この下限は「作品として読めないもの」を止めるためのもので、
 *   出来の良し悪しを裁くためのものではない。だから 10 点という低さにしてある。
 *   prompt でも「努力して書かれたものに 10 未満を付けない」と縛っている。
 *
 * 窓口
 *   GET                       … 保存されている講評を返す (無ければ null)
 *   POST {}                   … 本文が変わっていれば作り直す。同じなら前のを返す
 *   POST { force: true }      … 本文が同じでも作り直す
 *   POST { publish: true }    … 作品ページに載せる
 *   POST { publish: false }   … 引っ込める
 */

import { json, loadForReader, requireAuthorOrOwner, STATUS } from '../../../_drafts.js';
import { db } from '../../../_d1.js';

// 記録の版。形を変えたら上げる。古い記録は作り直す。
const REC_VERSION = 3;   // 2026-10-20 指示文を直したので上げる(古い記録は作り直す)

// これ未満は公開を認めない。作品として読めないものを止めるための下限。
export const PUBLISH_MIN_SCORE = 10;

// 一度に見せる本文の量。全文は読ませない。
// 『吾輩は猫である』は31万字あり、全文を毎回読ませると
// Workers AI の1日10,000 Neurons では到底足りない。
const SAMPLE_HEAD = 2600;
const SAMPLE_MID  = 1600;
const SAMPLE_TAIL = 1600;
const SAMPLE_MAX  = SAMPLE_HEAD + SAMPLE_MID + SAMPLE_TAIL;

// 1人が1日に走らせてよい回数。AIの枠を1人で使い切らせないため。
const RUNS_PER_DAY = 20;

const MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/google/gemma-3-12b-it',
];

const AXES = [
  ['時代背景',   'いつの、どういう世界の話として立ち上がっているか'],
  ['表現力',     '文章そのものの運び。描写、会話、間の取り方'],
  ['登場人物',   '人物が見分けられるか。動機が見えるか'],
  ['独自性',     'どこかで読んだ話に見えないか'],
  ['読みごたえ', '読み終えたときに何か残るか'],
];

/* 英語で読む人に向けた観点の名前。
 * 日本語の5つと一対一で対応させること。順番も変えない。
 * viewer.html の I18N_DICT にも同じ対応を入れてある（古い記録は
 * 日本語の観点名で保存されているので、そちらは辞書で訳す）。 */
const AXES_EN = [
  ['Setting and period', 'When and in what world the story stands up'],
  ['Writing',            'How the prose moves. Description, dialogue, pacing'],
  ['Characters',         'Whether people are distinguishable, and their motives visible'],
  ['Originality',        'Whether it reads like something read elsewhere'],
  ['Staying power',      'Whether anything stays with you after the last line'],
];

/* 扱う言語。ここに無い言語を求められたら日本語で返す。 */
const LANGS = ['ja', 'en'];
function normLang(v) {
  const l = String(v || 'ja').toLowerCase().slice(0, 2);
  return LANGS.indexOf(l) >= 0 ? l : 'ja';
}

const kvOf = (env) => env.WORKS || env.WORKS_KV || null;
const critiqueKey = (id) => 'critique:' + id;

/* ---------------------------------------------------------------------
 * 公開済みの作品も対象にする
 * ---------------------------------------------------------------------
 * 2026-10-19 追加。
 *
 * もとは下書き (draft_…) だけを見ていた。しかし作者が講評を見たいのは
 * たいてい公開済みの作品で、しかも古い作品にはもとになる下書きが
 * 残っていないものがある。下書きが無いという理由で断るのは、
 * 作者から見れば「使えない」のと同じ。
 *
 * 公開作品の本体は work:<pubId> に入っていて、中身は下書きの data に
 * ownerEmail を足したものなので、本文の取り出しはそのまま使える。
 *
 * 一度つけた講評は critique:<pubId> に残る。本文が変わっていなければ
 * 読み直さずにそれを返す (ensureCritique の isFresh)。AIを何度も
 * 走らせない。
 */
const PUB_ID_RE = /^pub_[A-Za-z0-9_-]{1,80}$/;

async function loadPublished(context, id) {
  const kv = kvOf(context.env);
  if (!kv) return { deny: json({ error: 'kv_unbound', message: 'KV が未設定です。' }, 500) };

  const gate = await requireAuthorOrOwner(context);
  if (gate.deny) return gate;

  let data = null;
  try {
    const raw = await kv.get('work:' + id);
    data = raw ? JSON.parse(raw) : null;
  } catch (e) { data = null; }
  if (!data) {
    return { deny: json({ error: 'not_found',
                          message: 'この作品の本体が見つかりません。' }, 404) };
  }

  // 持ち主の正は D1 の works_meta。作品の中身に入っている ownerEmail は、
  // 下書きの仕組みができる前に公開した作品にしか無い。
  // 2026-10-20: ここは中身の ownerEmail だけを見ていた。いまある15作品の
  // うち13作品にその欄が無く、サイトの持ち主以外の作者は自分の作品でも
  // 断られる状態だった（持ち主だけが gate.isOwner で通れていた）。
  const email = String((gate.who && gate.who.email) || '').toLowerCase();
  let owner = '';
  try {
    const d = db(context.env);
    if (d) {
      const row = await d.prepare('SELECT owner_email FROM works_meta WHERE work_id = ?1')
        .bind(id).first();
      if (row && row.owner_email) owner = String(row.owner_email).toLowerCase();
    }
  } catch (e) { /* D1 が無い・引けないときは中身の欄を見る */ }
  if (!owner) owner = String(data.ownerEmail || '').toLowerCase();
  const mine = !!owner && owner === email;

  // 自分の作品か、サイトの持ち主か。持ち主を許すのは、どちらにも
  // 持ち主の名前が入っていない古い作品を救うため。
  if (!mine && !gate.isOwner) {
    return { deny: json({ error: 'forbidden',
                          message: '自分の作品だけが対象です。' }, 403) };
  }

  return {
    who: gate.who, isOwner: gate.isOwner, mine: mine || gate.isOwner,
    draft: { id, data, title: (data.novel && data.novel.title) || '' },
  };
}

/** draft_ なら下書きを、pub_ なら公開作品を読む。 */
async function loadAny(context, id, opts) {
  if (PUB_ID_RE.test(String(id || ''))) return loadPublished(context, id);
  return loadForReader(context, id, opts);
}
const runsKey = (email, day) => 'critique_runs:' + String(email).toLowerCase() + ':' + day;

/** 日本時間の日付。枠の数え直しは日本時間の0時に揃える。 */
function jstDay(ms) {
  const d = new Date((ms || Date.now()) + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function sha256hex(s) {
  const b = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 下書きから本文を取り出す。話者が分かるものは「名前「台詞」」の形にする。 */
export function plainText(draft) {
  const data = draft.data || {};
  const content = Array.isArray(data.content) ? data.content : [];
  const chars = Array.isArray(data.characters) ? data.characters : [];
  const nameOf = {};
  chars.forEach((c) => { if (c && c.id) nameOf[c.id] = c.name || ''; });

  const lines = [];
  for (const c of content) {
    const t = String((c && c.text) || '').trim();
    if (!t) continue;
    const who = c && c.characterId && c.characterId !== 'narrator' ? nameOf[c.characterId] : '';
    lines.push(who ? who + '「' + t + '」' : t);
  }
  return lines.join('\n');
}

/** 冒頭・中盤・終盤を抜き出す。抜いた場所が分かるよう印を入れる。 */
export function sample(text) {
  if (text.length <= SAMPLE_MAX) return { text, partial: false };
  const head = text.slice(0, SAMPLE_HEAD);
  const midAt = Math.floor(text.length / 2) - Math.floor(SAMPLE_MID / 2);
  const mid = text.slice(midAt, midAt + SAMPLE_MID);
  const tail = text.slice(-SAMPLE_TAIL);
  return {
    text: head + '\n\n〔中略〕\n\n' + mid + '\n\n〔中略〕\n\n' + tail,
    partial: true,
  };
}

export function buildPrompt(meta, body, lang) {
  if (normLang(lang) === 'en') return buildPromptEn(meta, body);
  const axisList = AXES.map(([n, d]) => `  - ${n}: ${d}`).join('\n');
  return `あなたは、小説投稿サイトで作者本人に講評を返す編集者です。
この講評は作者が読みます。作者を書き続ける気にさせることが仕事です。

【守ること】
1. 必ず本文の具体的な箇所に触れる。「面白い」「読みやすい」だけの
   一般論は書かない。どの場面の、どの書き方がそうなのかを示す。
2. 良いところを先に、具体的に書く。お世辞ではなく、本当に効いている
   ところを見つけて言語化する。作者が自分で気づいていない長所を
   見つけられたら最良。
3. 直すべき点は「欠点」としてではなく「ここをこうすると、さらに
   こうなる」という形で書く。何がどう良くなるのかまで書く。
4. 批判的な言い回し、見下した言い回しは使わない。
   「稚拙」「ありきたり」「物足りない」のような語は使わない。
5. 日本語で、ですます調で書く。
6. summary は、観点ごとの講評の繰り返しにしない。全体として何が
   良くて、何を直すとさらに良くなるのかを、短くまとめる。2〜3文。
   strengths と suggestions も、観点ごとの講評と同じ話を繰り返さない。

【点数のつけ方】観点ごとに 0〜100 点の整数。
  90〜100 : 商業出版の水準にある
  70〜 89 : 人に勧められる
  50〜 69 : 読む価値がある
  30〜 49 : 粗いが、見るべきところがある
  10〜 29 : 体裁は整っている。読み物になるまでもう少し
   0〜  9 : 作品として読めない（白紙同然、意味をなさない文字列、
            本文がほとんど無い、など）
  ※ 9点以下は、本当に作品として読めない場合にだけ付けてください。
     努力して書かれたものには付けません。迷ったら 30 以上にしてください。
  ※ 点数は 5 の倍数に丸めず、1点きざみで細かく付けてください。
  ※ 5つの観点に、はっきり差をつけてください。この作品がどの観点で
     抜きん出ていて、どの観点に伸びしろがあるのかが、点を見ただけで
     分かるようにしてください。同じような点を並べないでください。
  ※ この指示文に書かれた数字や例文を、そのまま写さないでください。
     必ず、いま渡された本文を読んで決めてください。

【評価の観点】
${axisList}

【作品】
題名: ${meta.title}
作者: ${meta.author}
${meta.description ? 'あらすじ: ' + meta.description + '\n' : ''}${meta.partial ? '※ 長編のため、冒頭・中盤・終盤を抜き出したものを読んでいます。\n' : ''}
---
${body}
---

【出力】
次のJSONだけを返してください。前後に説明を付けないでください。
山かっこの中は、この作品を読んで決めた中身に置き換えてください。
{
  "axes": [
    {"name": "時代背景", "score": <整数>, "comment": "<この作品の、どの箇所がそうなのか>"},
    {"name": "表現力", "score": <整数>, "comment": "<同上>"},
    {"name": "登場人物", "score": <整数>, "comment": "<同上>"},
    {"name": "独自性", "score": <整数>, "comment": "<同上>"},
    {"name": "読みごたえ", "score": <整数>, "comment": "<同上>"}
  ],
  "strengths": ["<具体的な長所>", "<具体的な長所>"],
  "suggestions": ["<ここをこうすると、さらにこうなる>"],
  "nextStep": "<次に手を付けるなら、一点だけ、具体的に>",
  "summary": "<全体として良いところと、直すとさらに良くなるところ。2〜3文>"
}
各 comment は80〜160字。strengths と suggestions は各2〜3件、1件100〜180字。
nextStep は60〜120字。`;
}

/* 英語で読む人に向けた講評の指示文。
 * ------------------------------------------------------------------
 * 2026-10-22 追加。英語で開いたときに、画面の見出しだけ英語で中身が
 * 日本語、という状態だったため。訳すのではなく、英語で書かせる。
 * 講評は数百字しかないので、本文の翻訳よりAIの負担は軽い。
 *
 * 日本語版と同じことを言っていること。片方だけ直すと、同じ作品の
 * 講評が言語によって別の基準で書かれることになる。 */
function buildPromptEn(meta, body) {
  const axisList = AXES_EN.map(([n, d]) => `  - ${n}: ${d}`).join('\n');
  return `You are an editor on a fiction-posting site, writing a critique for the author themselves.
The author will read this. Your job is to leave them wanting to keep writing.

[Rules]
1. Always point at specific places in the text. Do not write generalities
   like "interesting" or "easy to read". Say which scene, and which way of
   writing it, does that.
2. Put what works first, and be specific. Not flattery: find what is
   genuinely doing work and put it into words. Best of all is naming a
   strength the author has not noticed themselves.
3. Write what to fix not as a fault but as "do this here, and it becomes
   that". Say what gets better, and how.
4. Use no critical or condescending turns of phrase. Do not use words like
   "clumsy", "derivative", or "lacking".
5. Write in English, in plain, courteous prose.
5a. Use the Latin alphabet only. Never write Japanese characters, not even
   for a name. Write names of people and places in Hepburn romanisation
   (for example a name written in kanji becomes Minokichi, O-Yuki).
   Translate any other Japanese word into English. The reader may have no
   Japanese font on their computer, so Japanese characters show as blank
   boxes and cannot be read at all.
6. Do not let summary repeat the per-axis comments. Say briefly what is good
   overall and what would make it better. Two or three sentences.
   strengths and suggestions must not repeat the per-axis comments either.

[How to score] An integer from 0 to 100 for each axis.
  90-100 : at the standard of commercial publication
  70- 89 : worth recommending to someone
  50- 69 : worth reading
  30- 49 : rough, but there is something to see
  10- 29 : presentable; a little further to being a piece of reading
   0-  9 : cannot be read as a work (effectively blank, meaningless
           strings of characters, almost no text, and so on)
  * Give 9 or below only when the work truly cannot be read. Never give it
    to something written with effort. When in doubt, give 30 or more.
  * Do not round to multiples of 5. Score to the single point.
  * Make the five axes clearly different from one another. Someone looking
    only at the numbers should see where this work stands out and where it
    has room. Do not line up similar scores.
  * Do not copy any number or example sentence from these instructions.
    Decide everything from the text you have just been given.

[Axes]
${axisList}

[The work]
Title: ${meta.title}
Author: ${meta.author}
${meta.description ? 'Blurb: ' + meta.description + '\n' : ''}${meta.partial ? '* This is a long work; you are reading the opening, the middle and the ending.\n' : ''}
---
${body}
---

[Output]
Return only the following JSON. Add no explanation before or after.
Replace what is inside the angle brackets with what you decided from reading the work.
{
  "axes": [
    {"name": "Setting and period", "score": <integer>, "comment": "<which place in this work, and why>"},
    {"name": "Writing", "score": <integer>, "comment": "<same>"},
    {"name": "Characters", "score": <integer>, "comment": "<same>"},
    {"name": "Originality", "score": <integer>, "comment": "<same>"},
    {"name": "Staying power", "score": <integer>, "comment": "<same>"}
  ],
  "strengths": ["<a specific strength>", "<a specific strength>"],
  "suggestions": ["<do this here, and it becomes that>"],
  "nextStep": "<if you work on one thing next: one thing, concrete>",
  "summary": "<what is good overall, and what would make it better. 2-3 sentences>"
}
Each comment is 60 to 120 words. strengths and suggestions are 2 to 3 items each,
80 to 140 words per item. nextStep is 50 to 90 words.
Every character you return must be in the Latin alphabet. Romanise the names.`;
}

/** モデルの返事からJSONを取り出す。``` で囲ってくることがある。 */
export function parseResult(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o;
  try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  if (!o || !Array.isArray(o.axes)) return null;

  const axes = o.axes
    .filter((x) => x && x.name)
    .map((x) => {
      // 点が無い・数でない → 50 (判断できないものを低く扱わない)。
      // 点はあるが範囲外 → 0〜100 に丸める。
      // Number(x) || 50 と書くと 0 点が「欠損」に化けるので書かない。
      const n = Number(x.score);
      return {
        name: String(x.name).slice(0, 20),
        score: Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50,
        comment: String(x.comment || '').slice(0, 400),
      };
    });
  if (!axes.length) return null;

  const list = (v) => (Array.isArray(v) ? v : [])
    .map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)
    .map((x) => x.slice(0, 400));

  return {
    axes,
    strengths: list(o.strengths),
    suggestions: list(o.suggestions),
    nextStep: String(o.nextStep || '').slice(0, 400),
    summary: String(o.summary || '').slice(0, 800),
    total: Math.round(
      (axes.reduce((a, x) => a + x.score, 0) / axes.length) * 10) / 10,
  };
}

/** いちばん低かった観点。公開を断る理由として示す。 */
export function weakestAxis(result) {
  if (!result || !Array.isArray(result.axes) || !result.axes.length) return null;
  return result.axes.reduce((a, x) => (x.score < a.score ? x : a), result.axes[0]);
}

/**
 * 公開を認められないときの文面。
 * 文面は必ずここで組み立てる。いちばん効いてほしい言葉を、
 * モデルの機嫌に委ねたくないため。
 */
export function rejectionMessage(result, title) {
  const w = weakestAxis(result);
  const why = w ? `${w.name}の評価が ${w.score} 点にとどまったため` : '評価が基準に届かなかったため';
  const how = (result && (result.nextStep || (result.suggestions || [])[0]))
    || '構成と描写を見直していただく';
  return `「${title || 'この作品'}」は、${why}、今回は公開に至りませんでした。`
    + `総合 ${result ? result.total : 0} 点（公開には ${PUBLISH_MIN_SCORE} 点が必要です）。\n\n`
    + `ただ、ここを直せば大きく変わります。${how}\n\n`
    + `講評には良かったところも書いてあります。どうか諦めずに、`
    + `手を入れたうえで、もう一度お送りください。お待ちしています。`;
}

/**
 * 作品を読まずに返していないかを見る。
 * ----------------------------------------------------------------------
 * 2026-10-20。全作品がきっちり 60 点になった。原因は指示文の記入例に
 * 書いた数字 (62/71/55/48/64、平均ちょうど 60) を、モデルがそのまま
 * 写していたこと。例から数字は消したが、写しは他の形でも起こりうる。
 * 点に差が無いものは、読んでいない印として扱い、次の型に回す。
 */
const OLD_EXAMPLE = [62, 71, 55, 48, 64];

function echoed(parsed) {
  const scores = (parsed.axes || []).map((a) => a.score);
  if (scores.length < 2) return null;
  if (scores.every((v, i) => v === OLD_EXAMPLE[i])) return '記入例の数字をそのまま返しています';
  if (new Set(scores).size === 1) return '5つの観点が全部同じ点です';
  const hi = Math.max.apply(null, scores), lo = Math.min.apply(null, scores);
  if (hi - lo < 4) return '観点ごとの差がほとんどありません (' + lo + '〜' + hi + ')';
  return null;
}

/* 英語の講評に日本語が混じっていないか。
 *
 * 2026-10-22: 英語で作った講評の中で、登場人物の名前だけが
 * 原文のまま (巳之吉 / お雪) 出ていた。日本語の書体が入っていない
 * パソコンでは、そこだけ豆腐(□)になって読めない。
 * 指示文で釘は刺したが、守らないことがあるので、出たものを見て、
 * 混じっていたら一度だけ直させる。 */
const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff01-\uff60]/;

function cjkLeft(parsed) {
  const out = [];
  const push = (v) => { if (typeof v === 'string' && CJK_RE.test(v)) out.push(v); };
  for (const a of (parsed.axes || [])) { push(a && a.name); push(a && a.comment); }
  for (const v of (parsed.strengths || [])) push(v);
  for (const v of (parsed.suggestions || [])) push(v);
  push(parsed.nextStep); push(parsed.summary);
  return out;
}

function repairPrompt(parsed) {
  return `The JSON below is a critique written for a reader who cannot read Japanese.
It still contains Japanese characters. Rewrite it so that every character is in
the Latin alphabet.
  - Names of people and places: Hepburn romanisation.
  - Any other Japanese word or phrase: translate it into English.
Change nothing else. Keep every score exactly as it is, and keep each sentence
as it is apart from the Japanese parts you are replacing.
Return only the JSON, with no explanation before or after.

${JSON.stringify(parsed)}`;
}

/* 保存済みの英語の講評から、日本語だけを取り除く。
 * 作り直しではない。点も文もそのままで、名前をローマ字にするだけ。
 * 2026-10-22: 指示文を直す前に作った講評が残っており、作者に
 * 「もう一度みてもらう」を押してもらうしかなかった。作品の数だけ
 * 押させるのは筋が悪いので、読まれたときに一度だけ自分で直す。 */
export async function repairLatin(env, parsed) {
  if (!env || !env.AI || !parsed) return null;
  for (const m of MODELS) {
    try {
      const r = await env.AI.run(m, {
        messages: [{ role: 'user', content: repairPrompt(parsed) }],
        max_tokens: 1800,
        temperature: 0,
      });
      const t = (r && (r.response || r.result || r.output_text)) || '';
      const p2 = parseResult(t);
      if (p2 && (p2.axes || []).length && !cjkLeft(p2).length) return p2;
    } catch (e) {
      console.warn('[critique] 直しに失敗しました (' + m + '):', String(e && e.message));
    }
  }
  return null;
}

async function runAI(env, prompt, opts) {
  const o = opts || {};
  let lastErr = null;
  for (const m of MODELS) {
    try {
      const r = await env.AI.run(m, {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1800,
        temperature: 0.4,     // 毎回まるきり違う点数が出ないよう低めにする
      });
      const text = (r && (r.response || r.result || r.output_text)) || '';
      const parsed = parseResult(text);
      if (parsed) {
        const bad = echoed(parsed);
        if (!bad) {
          if (!o.latinOnly || !cjkLeft(parsed).length) {
            return { ok: true, model: m, result: parsed };
          }
          // 日本語が混じっている。同じ型に、名前だけ直させる。
          console.warn('[critique] ' + m + ' の英語の講評に日本語が混じっています: '
            + cjkLeft(parsed).join(' / ').slice(0, 120));
          try {
            const r2 = await env.AI.run(m, {
              messages: [{ role: 'user', content: repairPrompt(parsed) }],
              max_tokens: 1800,
              temperature: 0,
            });
            const t2 = (r2 && (r2.response || r2.result || r2.output_text)) || '';
            const p2 = parseResult(t2);
            if (p2 && (p2.axes || []).length && !cjkLeft(p2).length) {
              return { ok: true, model: m, result: p2, repaired: true };
            }
          } catch (e) {
            console.warn('[critique] 直しに失敗しました:', String(e && e.message));
          }
          /* 直せなかった。講評そのものは出す。
             何も出さないより、名前だけ原文のまま出すほうがましなので。 */
          return { ok: true, model: m, result: parsed, cjkLeft: cjkLeft(parsed).length };
        }
        // 作品を読まずに返している。次の型に回す。
        console.warn('[critique] ' + m + ' が読まずに答えました: ' + bad);
        lastErr = new Error(bad);
      } else {
        lastErr = new Error('JSONとして読めない返事: ' + String(text).slice(0, 120));
      }
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, error: String((lastErr && lastErr.message) || '不明') };
}

async function loadStored(env, id) {
  const kv = kvOf(env);
  if (!kv) return null;
  try {
    const raw = await kv.get(critiqueKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

async function saveStored(env, id, rec) {
  const kv = kvOf(env);
  if (!kv) return false;
  try { await kv.put(critiqueKey(id), JSON.stringify(rec)); return true; }
  catch (e) { return false; }
}

const NOTE = 'これはAIによる読みの一例です。点数は絶対的な評価ではありません。'
           + '同じ作品でも、読む人によって受け取り方は変わります。';
const NOTE_EN = 'This is one example of how an AI read the work. The scores are not an '
              + 'absolute judgement. The same work lands differently on different readers.';
function noteFor(lang) { return normLang(lang) === 'en' ? NOTE_EN : NOTE; }

/* 言語ごとの講評を1つの記録に入れる。
 * ------------------------------------------------------------------
 * 2026-10-22: 記録は result 1つだけを持っていた。英語で開くと画面の
 * 見出しだけ英語で、中身は日本語のままだった。
 *
 * 形:
 *   rec.results = { ja: {result, model, createdAt}, en: {...} }
 *   rec.result  = results.ja.result   ← 昔の形のまま残す
 *   rec.model   = results.ja.model
 *
 * result を残すのは、公開審査の経路 (api/drafts/[id]/submit.js) が
 * critique.result.total を見て下限を判定しているため。あそこは
 * 日本語で動いていればよく、言語の話は持ち込まない。
 *
 * 版 (REC_VERSION) は上げない。上げると既にある講評が全部
 * 「作り直し」になり、作者が見ていたものが消える。古い記録は
 * 日本語の講評として読めるので、そのまま使える。 */
function resultFor(rec, lang) {
  if (!rec) return null;
  const l = normLang(lang);
  if (rec.results && rec.results[l] && rec.results[l].result) return rec.results[l];
  // 昔の形。日本語として扱う。
  if (l === 'ja' && rec.result) {
    return { result: rec.result, model: rec.model || '', createdAt: rec.createdAt };
  }
  return null;
}

/** その記録が持っている言語。画面が「英語版はまだ無い」と出せるように。 */
function langsOf(rec) {
  if (!rec) return [];
  const out = [];
  LANGS.forEach((l) => { if (resultFor(rec, l)) out.push(l); });
  return out;
}

/** 言語ぶんを記録に入れる。ほかの言語と公開の印は触らない。 */
function putResult(rec, lang, result, model) {
  const l = normLang(lang);
  rec.results = rec.results || {};
  rec.results[l] = { result, model, createdAt: new Date().toISOString() };
  if (l === 'ja') { rec.result = result; rec.model = model; }
  return rec;
}

/** 保存されたものが、いまの本文・いまの形式に合っているか。 */
function isFresh(rec, hash, lang) {
  if (!(rec && rec.hash === hash && rec.v === REC_VERSION)) return false;
  const got = resultFor(rec, lang);
  return !!(got && got.result && typeof got.result.total === 'number');
}

/**
 * 講評を用意する。公開依頼の経路 (submit.js) からも呼ぶ。
 * 本文が変わっていなければ作り直さない。
 * 作れなかったときは null を返す。**呼び出し側は null を理由に
 * 公開を止めてはいけない。** AIの不調で投稿を拒むことになるため。
 */
export async function ensureCritique(context, draft, opts) {
  const o = opts || {};
  const env = context.env;
  const text = plainText(draft);
  if (text.length < 200) return null;

  const lang = normLang(o.lang);
  const hash = (await sha256hex(text)).slice(0, 40);
  const stored = await loadStored(env, draft.id);
  if (isFresh(stored, hash, lang) && !o.force) return stored;
  if (!env.AI) return null;

  // 1日の回数を見る
  const kv = kvOf(env);
  const email = (o.email) || '';
  const rk = runsKey(email, jstDay());
  if (kv && email) {
    let runs = 0;
    try { runs = parseInt(await kv.get(rk) || '0', 10) || 0; } catch (e) { runs = 0; }
    if (runs >= RUNS_PER_DAY) return { tooMany: true, 上限: RUNS_PER_DAY };
  }

  const s = sample(text);
  const novel = (draft.data && draft.data.novel) || {};
  const meta = {
    title: novel.title || draft.title || '無題',
    author: draft.penName || novel.author || '',
    description: String(novel.description || '').slice(0, 300),
    partial: s.partial,
  };

  const ai = await runAI(env, buildPrompt(meta, s.text, lang), { latinOnly: lang === 'en' });
  if (!ai.ok) {
    // 理由を捨てない。502 だけ返されても、作者にも私にも何も分からない。
    // (2026-10-20 実際に 502 が出て、原因が追えなかった。)
    console.warn('[critique] AIが応えませんでした:', ai.error);
    return { aiFailed: true, reason: ai.error, tried: MODELS.length };
  }

  if (kv && email) {
    let runs = 0;
    try { runs = parseInt(await kv.get(rk) || '0', 10) || 0; } catch (e) { runs = 0; }
    try { await kv.put(rk, String(runs + 1), { expirationTtl: 60 * 60 * 36 }); } catch (e) {}
  }

  // 本文が変わっていなければ、ほかの言語の講評は残す。
  // 変わっていれば、どの言語のものも古いので捨てる。
  const keep = (stored && stored.hash === hash && stored.v === REC_VERSION)
    ? (stored.results || {}) : {};
  const rec = {
    v: REC_VERSION,
    hash,
    createdAt: new Date().toISOString(),
    partial: s.partial,
    charCount: text.length,
    // 公開は引き継ぐ。作り直すたびに勝手に公開されるのも、勝手に
    // 引っ込むのも困る。初回だけ false。
    // 言語ごとには分けない。作者が公開するのは「この作品の講評」で、
    // 英語だけ公開する／しないという選び方は画面にも無い。
    published: stored ? !!stored.published : false,
    publishedAt: stored ? (stored.publishedAt || null) : null,
    results: Object.assign({}, keep),
  };
  // 昔の形で保存されていた日本語の講評も引き継ぐ。
  if (!rec.results.ja && stored && stored.hash === hash && stored.result) {
    rec.results.ja = { result: stored.result, model: stored.model || '',
                       createdAt: stored.createdAt };
  }
  putResult(rec, lang, ai.result, ai.model);
  /* 公開審査の経路 (submit.js) は rec.result.total を見る。
   * そこに置くのは日本語のものにする。審査は日本語で動いている。
   * 日本語がまだ無いとき（英語だけ作ったとき）は、下限の判定が
   * できなくなるので、いま作ったものを置く。 */
  if (rec.results.ja && rec.results.ja.result) {
    rec.result = rec.results.ja.result;
    rec.model = rec.results.ja.model;
  } else {
    rec.result = ai.result;
    rec.model = ai.model;
  }
  await saveStored(env, draft.id, rec);
  return rec;
}

/** 公開中の作品の講評を、読者に見せてよい形で返す。 */
export async function publicCritique(env, draftId, lang) {
  const rec = await loadStored(env, draftId);
  if (!rec || !rec.published) return null;
  const want = normLang(lang);
  // 求められた言語が無ければ、持っているものを返す。
  // 英語で開いた読者に何も出さないより、日本語でも出す方がよい。
  const got = resultFor(rec, want) || resultFor(rec, 'ja') || resultFor(rec, 'en');
  if (!got || !got.result) return null;
  const r = got.result;
  return { total: r.total, axes: r.axes, strengths: r.strengths, summary: r.summary,
           createdAt: got.createdAt || rec.createdAt,
           lang: (resultFor(rec, want) ? want : (rec.results && rec.results.ja ? 'ja' : 'ja')),
           注意: noteFor(resultFor(rec, want) ? want : 'ja') };
}

export async function onRequestGet(context) {
  // mineOnly を外す。オーナーが審査のために読む場合があるため。
  const r = await loadAny(context, context.params.id);
  if (r.deny) return r.deny;

  // 公開済みの作品は、読めた時点で持ち主の確認が済んでいる。
  if (!r.mine && !PUB_ID_RE.test(String(context.params.id || ''))) {
    // 他人の下書き。オーナーが、公開を依頼されたものを見る場合だけ許す。
    // まだ下書きのうちは、オーナーであっても開けない。
    const st = r.draft.status;
    const opened = (st === STATUS.REVIEW || st === STATUS.PUBLISHED);
    if (!(r.isOwner && opened)) {
      return json({ error: 'forbidden',
                    message: '講評は作者本人のものです。'
                           + '公開を依頼されたものだけ、運営者が確認できます。' }, 403);
    }
  }

  const rec = await loadStored(context.env, r.draft.id);
  // 指示文を直した後は、古い版の講評をそのまま見せない。
  // (2026-10-20 全作品 60 点だった分は、これで作り直しの対象になる。)
  const stale = !!(rec && rec.v !== REC_VERSION);

  /* 本文が、講評を作ったときから変わっているか。
   * 2026-10-22 追加。これまで知らせる手立てが無く、作者は書き直した
   * あとも古い本文に対する講評を見ていた。
   * 見せるのは止めない（止めると、少し直すたびに講評が消える）。
   * 画面が「本文が変わっています」と添えられるようにするだけ。 */
  let outdated = false;
  try {
    const nowText = plainText(r.draft);
    if (rec && rec.hash && nowText.length >= 200) {
      outdated = rec.hash !== (await sha256hex(nowText)).slice(0, 40);
    }
  } catch (e) { outdated = false; }

  // 読む言語。画面が ?lang=en を付けて呼ぶ。
  const want = normLang(new URL(context.request.url).searchParams.get('lang'));
  let got = resultFor(rec, want);
  // 画面は critique.result を見る作りなので、求められた言語の講評を
  // そこに差し替えて返す。無ければ null を入れ、画面に「まだ無い」と
  // 分かるようにする（勝手に日本語を出すと、英語で読む人には
  // 読めないものが出てしまう）。
  /* 英語の講評に日本語が残っていないか。
   * 作り直す前に作った分には、登場人物の名前が原文のまま入っている。
   * 日本語の書体が入っていないパソコンでは読めないので、画面に
   * 「作り直せます」と添えられるように知らせる。 */
  let mixed = !!(want === 'en' && got && got.result && cjkLeft(got.result).length);

  /* 混じっていたら、その場で一度だけ直す。
   * 失敗したときは印を残し、読まれるたびにAIを呼ばないようにする。
   * 直しは講評を作り直すのではないので、1日の回数には数えない。 */
  let repaired = false;
  if (mixed && !rec.enRepairFailed && context.env.AI) {
    const fixed = await repairLatin(context.env, got.result);
    if (fixed) {
      rec.results = rec.results || {};
      rec.results.en = Object.assign({}, rec.results.en, { result: fixed });
      rec.enRepaired = new Date().toISOString();
      got = rec.results.en;
      mixed = false;
      repaired = true;
    } else {
      rec.enRepairFailed = new Date().toISOString();
    }
    await saveStored(context.env, r.draft.id, rec);
  }

  let out = rec;
  if (rec) {
    out = Object.assign({}, rec, {
      result: got ? got.result : null,
      model: got ? got.model : null,
      lang: want,
      言語: want,
      ある言語: langsOf(rec),
      日本語が混じっている: mixed,
    });
  }
  return json({ ok: true, id: r.draft.id, critique: out, stale: stale,
                outdated: outdated, 本文が変わっている: outdated,
                lang: want, ある言語: langsOf(rec), 日本語が混じっている: mixed,
                名前を直した: repaired,
                読んでいるのは: r.mine ? '作者本人' : '運営者',
                公開の下限: PUBLISH_MIN_SCORE, 注意: noteFor(want) });
}

export async function onRequestPost(context) {
  // 作り直しと公開の切り替えは本人だけ。
  const r = await loadAny(context, context.params.id, { mineOnly: true });
  if (r.deny) return r.deny;

  const env = context.env;
  const draft = r.draft;
  let body = {};
  try { body = await context.request.json(); } catch (e) { body = {}; }

  // ---- 公開・非公開の切り替えだけ。AIは走らせない ----
  if (body.publish !== undefined) {
    const stored = await loadStored(env, draft.id);
    if (!stored) {
      return json({ error: 'no_critique',
                    message: 'まだ講評がありません。先に作成してください。' }, 409);
    }
    stored.published = body.publish === true;
    stored.publishedAt = stored.published ? new Date().toISOString() : null;
    await saveStored(env, draft.id, stored);
    const pl = normLang(body.lang);
    const pg = resultFor(stored, pl);
    return json({ ok: true, id: draft.id, published: stored.published,
                  critique: Object.assign({}, stored, {
                    result: pg ? pg.result : null, model: pg ? pg.model : null,
                    lang: pl, ある言語: langsOf(stored) }),
                  lang: pl });
  }

  // ---- 講評を作る ----
  const text = plainText(draft);
  if (text.length < 200) {
    return json({ error: 'too_short',
                  message: '本文が短すぎます。200字以上書いてからお試しください。' }, 400);
  }
  if (!env.AI) {
    return json({ error: 'not_configured', message: 'AI が未設定です。' }, 500);
  }

  const wantLang = normLang(body.lang);
  const rec = await ensureCritique(context, draft,
    { force: !!body.force, email: r.who && r.who.email, lang: wantLang });

  if (rec && rec.aiFailed) {
    return json({ error: 'ai_failed',
                  message: 'AIが講評を返しませんでした。\n\n' + rec.reason
                         + '\n\n時間をおくと通ることがあります。'
                         + '何度も続くようなら、この文面をそのままお伝えください。',
                  理由: rec.reason, 試した型: rec.tried }, 502);
  }
  if (rec && rec.tooMany) {
    return json({ error: 'too_many_runs',
                  message: '本日の講評の作成回数の上限に達しました。'
                         + '日本時間の0時に戻ります。',
                  上限: rec.上限 }, 429);
  }
  if (!rec) {
    return json({ error: 'ai_failed',
                  message: '講評を作れませんでした。時間をおいてお試しください。' }, 502);
  }

  // 画面は critique.result を見る。作った言語のものを差し替えて返す。
  const made = resultFor(rec, wantLang);
  return json({ ok: true, id: draft.id,
                critique: Object.assign({}, rec, {
                  result: made ? made.result : rec.result,
                  model: made ? made.model : rec.model,
                  lang: wantLang, ある言語: langsOf(rec) }),
                lang: wantLang,
                公開の下限: PUBLISH_MIN_SCORE, 注意: noteFor(wantLang) });
}
