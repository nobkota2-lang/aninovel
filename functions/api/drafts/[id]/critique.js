/**
 * AIによる講評  /api/drafts/:id/critique
 * ============================================================
 * 2026-10-18 追加。
 *
 * 何のためのものか
 *   作者が自分の作品について、読み手がどう受け取るかを知るための道具。
 *   審査ではない。公開を止める力も、点数で作品を並べる力も持たない。
 *
 * 誰が見られるか
 *   作者本人だけ。オーナーであっても他人の下書きは開けない
 *   (loadForReader に mineOnly を渡している)。
 *   公開するかどうかは作者が決める。既定は非公開。
 *
 * なぜ非公開を既定にしたか
 *   投稿してくれた方に、望まない点数が公開で付く仕組みにすると、
 *   その人は二度と来ない。作者を集めることと、作品を採点することは、
 *   同じ場所に置くと噛み合わない。だから採点は作者の持ち物にして、
 *   見せるかどうかを本人に委ねる。
 *
 * 書きぶりの方針
 *   けなさない。ただし褒めるだけにもしない。
 *   「良い。ここをこうするともっと良くなる」という形に寄せる。
 *   そのために、一般論を書かせないことを prompt で強く縛っている。
 *   「面白い作品です」では作者の役に立たない。
 *
 * 窓口
 *   GET                       … 保存されている講評を返す (無ければ null)
 *   POST {}                   … 本文が変わっていれば作り直す。同じなら前のを返す
 *   POST { force: true }      … 本文が同じでも作り直す
 *   POST { publish: true }    … 作品ページに載せる
 *   POST { publish: false }   … 引っ込める
 */

import { json, loadForReader } from '../../../_drafts.js';

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
  ['時代背景',    'いつの、どういう世界の話として立ち上がっているか'],
  ['表現力',      '文章そのものの運び。描写、会話、間の取り方'],
  ['登場人物',    '人物が見分けられるか。動機が見えるか'],
  ['独自性',      'どこかで読んだ話に見えないか'],
  ['読みごたえ',  '読み終えたときに何か残るか'],
];

const kvOf = (env) => env.WORKS || env.WORKS_KV || null;
const critiqueKey = (id) => 'critique:' + id;
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
function plainText(draft) {
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
function sample(text) {
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

function buildPrompt(meta, body) {
  const axisList = AXES.map(([n, d]) => `  - ${n}: ${d}`).join('\n');
  return `あなたは、小説投稿サイトで作者本人に講評を返す編集者です。
この講評は作者だけが読みます。作者を続ける気にさせることが仕事です。

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
5. 点数は1〜5の整数。3を「ふつう」とする。1は付けない。
   点数より、その理由の具体性を重視する。
6. 日本語で、ですます調で書く。

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
{
  "axes": [
    {"name": "時代背景", "score": 4, "comment": "..."},
    {"name": "表現力", "score": 4, "comment": "..."},
    {"name": "登場人物", "score": 4, "comment": "..."},
    {"name": "独自性", "score": 4, "comment": "..."},
    {"name": "読みごたえ", "score": 4, "comment": "..."}
  ],
  "strengths": ["具体的な長所", "具体的な長所"],
  "suggestions": ["ここをこうすると、さらにこうなる", "..."],
  "summary": "読者にとってこの作品がどういう読み物なのかを3〜4文で"
}
各 comment は80〜160字。strengths と suggestions は各2〜3件、1件100〜180字。`;
}

/** モデルの返事からJSONを取り出す。``` で囲ってくることがある。 */
function parseResult(raw) {
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
      // 点が無い・数でない → 3 (ふつう)。点はあるが範囲外 → 1〜5 に丸める。
      // Number(x) || 3 と書くと 0 点が「欠損」に化けて 3 になってしまう。
      const n = Number(x.score);
      return {
        name: String(x.name).slice(0, 20),
        score: Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3,
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
    summary: String(o.summary || '').slice(0, 800),
    average: Math.round(
      (axes.reduce((a, x) => a + x.score, 0) / axes.length) * 10) / 10,
  };
}

async function runAI(env, prompt) {
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
      if (parsed) return { ok: true, model: m, result: parsed };
      lastErr = new Error('JSONとして読めない返事: ' + String(text).slice(0, 120));
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

export async function onRequestGet(context) {
  const r = await loadForReader(context, context.params.id, { mineOnly: true });
  if (r.deny) return r.deny;
  const rec = await loadStored(context.env, r.draft.id);
  return json({ ok: true, id: r.draft.id, critique: rec, 注意: NOTE });
}

export async function onRequestPost(context) {
  const r = await loadForReader(context, context.params.id, { mineOnly: true });
  if (r.deny) return r.deny;

  const env = context.env;
  const draft = r.draft;
  let body = {};
  try { body = await context.request.json(); } catch (e) { body = {}; }

  const stored = await loadStored(env, draft.id);

  // ---- 公開・非公開の切り替えだけ。AIは走らせない ----
  if (body.publish !== undefined) {
    if (!stored) {
      return json({ error: 'no_critique',
                    message: 'まだ講評がありません。先に作成してください。' }, 409);
    }
    stored.published = body.publish === true;
    stored.publishedAt = stored.published ? new Date().toISOString() : null;
    await saveStored(env, draft.id, stored);
    return json({ ok: true, id: draft.id, published: stored.published,
                  critique: stored });
  }

  // ---- 本文を用意する ----
  const text = plainText(draft);
  if (text.length < 200) {
    return json({ error: 'too_short',
                  message: '本文が短すぎます。200字以上書いてからお試しください。' }, 400);
  }
  const hash = (await sha256hex(text)).slice(0, 40);

  // 本文が変わっていなければ作り直さない。AIの枠を無駄に使わないため。
  if (stored && stored.hash === hash && !body.force) {
    return json({ ok: true, id: draft.id, critique: stored,
                  作り直していない理由: '本文が前回と同じです。',
                  注意: NOTE });
  }

  if (!env.AI) {
    return json({ error: 'not_configured', message: 'AI が未設定です。' }, 500);
  }

  // ---- 1日の回数を見る ----
  const kv = kvOf(env);
  const day = jstDay();
  const rk = runsKey(r.who && r.who.email, day);
  let runs = 0;
  if (kv) {
    try { runs = parseInt(await kv.get(rk) || '0', 10) || 0; } catch (e) { runs = 0; }
    if (runs >= RUNS_PER_DAY) {
      return json({ error: 'too_many_runs',
                    message: '本日の講評の作成回数の上限に達しました。'
                           + '日本時間の0時に戻ります。',
                    上限: RUNS_PER_DAY }, 429);
    }
  }

  const s = sample(text);
  const novel = (draft.data && draft.data.novel) || {};
  const meta = {
    title: novel.title || draft.title || '無題',
    author: draft.penName || novel.author || '',
    description: String(novel.description || '').slice(0, 300),
    partial: s.partial,
  };

  const ai = await runAI(env, buildPrompt(meta, s.text));
  if (!ai.ok) {
    return json({ error: 'ai_failed', message: ai.error }, 502);
  }

  if (kv) { try { await kv.put(rk, String(runs + 1), { expirationTtl: 60 * 60 * 36 }); } catch (e) {} }

  const rec = {
    hash,
    createdAt: new Date().toISOString(),
    model: ai.model,
    partial: s.partial,
    charCount: text.length,
    // 公開は引き継ぐ。作り直すたびに勝手に公開されるのも、勝手に
    // 引っ込むのも困る。初回だけ false。
    published: stored ? !!stored.published : false,
    publishedAt: stored ? (stored.publishedAt || null) : null,
    result: ai.result,
  };
  await saveStored(env, draft.id, rec);

  return json({ ok: true, id: draft.id, critique: rec, 注意: NOTE });
}
