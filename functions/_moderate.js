/**
 * AI による公序良俗チェックと、前の版との差分  functions/_moderate.js
 * ============================================================
 *
 * なぜ差分を見るのか
 *   公開済みの作品が編集されるたび全文を読み直すのは、運営者にも AI にも重い。
 *   前に承認した版と比べ、増えた行と変わった行だけを見れば、
 *   「今回の編集で何が持ち込まれたか」は分かる。
 *
 * どこまで AI に任せるか（ここは意識して線を引いている）
 *   ・文章  … AI が見る。判定は 3 段階（問題なし / 疑わしい / 明らかに不適切）
 *   ・画像  … AI に判断させない。Workers AI に信頼できる不適切画像の判定器が
 *             無いため、「見たふり」をすると一番危ない穴になる。
 *             画像が増えた編集は、無条件で運営者へ回す。
 *   ・AI が落ちた・答えが読めない … 素通りさせず、運営者へ回す（fail-safe）
 *
 * 小説の審査で気をつけたこと
 *   物語には人が死ぬし、暴力も出てくる。それ自体は文学であって違反ではない。
 *   「描いているか」ではなく「読者に行為をすすめているか」「必要のない
 *   露骨さがあるか」で見るように指示している。
 *   それでも誤判定は出る。だから編集の自動公開でも、疑わしければ人が見る。
 */

// 翻訳と同じ並び。前のモデルが落ちたら次を試す。
const MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/google/gemma-3-12b-it',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
];

// 1回の問い合わせに詰め込む上限。長すぎるとモデルが後半を読み飛ばす。
const CHARS_PER_CALL = 5000;
// 1回の審査で使う問い合わせの上限。青空文庫のような長編を丸ごと流さないため。
const MAX_CALLS = 4;

export const VERDICT = {
  OK: 'ok',           // 問題なし
  FLAG: 'flag',       // 疑わしい。人が見るべき
  BLOCK: 'block',     // 明らかに不適切
  UNKNOWN: 'unknown', // 判定できなかった。人が見るべき
};

/* ================= 差分 ================= */

function itemsOf(data) {
  return (data && Array.isArray(data.content)) ? data.content : [];
}

function textOf(it) {
  if (!it) return '';
  return String(it.text || it.content || '');
}

/** 画像・動画の点数と、その参照先を数える */
function mediaOf(data) {
  const out = { count: 0, refs: [] };
  itemsOf(data).forEach(it => {
    if (!it) return;
    if (it.type === 'image' || it.type === 'video') {
      out.count++;
      const ref = it.src || it.url || it.imageId || it.id || '';
      if (ref) out.refs.push(String(ref));
    }
  });
  // 登場人物のアイコンも画像
  const chars = (data && Array.isArray(data.characters)) ? data.characters : [];
  chars.forEach(c => {
    if (c && c.iconImage) { out.count++; out.refs.push('icon:' + (c.id || '') + ':' + String(c.iconImage).slice(0, 64)); }
  });
  return out;
}

/**
 * 前の版と今の版を比べる。
 * @returns {{added:string[], changed:string[], removedCount:number,
 *            newMedia:string[], isFirst:boolean, totalChars:number}}
 */
export function diffDraft(prevData, nextData) {
  const prev = itemsOf(prevData);
  const next = itemsOf(nextData);

  const isFirst = prev.length === 0;

  const prevById = new Map();
  prev.forEach(it => { if (it && it.id != null) prevById.set(String(it.id), textOf(it)); });

  const added = [], changed = [];
  const seen = new Set();
  next.forEach(it => {
    if (!it) return;
    const id = (it.id != null) ? String(it.id) : null;
    const t = textOf(it);
    if (!t.trim()) return;
    if (id && prevById.has(id)) {
      seen.add(id);
      if (prevById.get(id) !== t) changed.push(t);
    } else {
      added.push(t);
    }
  });

  let removedCount = 0;
  prevById.forEach((_v, k) => { if (!seen.has(k)) removedCount++; });

  // 増えた画像・動画
  const pm = mediaOf(prevData), nm = mediaOf(nextData);
  const prevRefs = new Set(pm.refs);
  const newMedia = nm.refs.filter(r => !prevRefs.has(r));

  const totalChars = added.concat(changed).reduce((a, b) => a + b.length, 0);
  return { added, changed, removedCount, newMedia, isFirst, totalChars };
}

/* ================= AI の審査 ================= */

const RUBRIC = `あなたは小説投稿サイトの内容審査を担当します。
渡された日本語または英語の文章を読み、公開してよいかを判定してください。

【重要な前提】
これは小説です。物語の中で人が死ぬこと、暴力が起きること、登場人物が
罪を犯すこと、恋愛や性愛が示唆されることは、それ自体では違反ではありません。
文学作品には当然そうした描写が含まれます。

【違反とすべきもの】
1. 性的: 性行為の露骨で具体的な描写。未成年者を性的に描いたもの（年齢の
   明示がなくても、学生・子どもとして描かれる人物を性的に扱うものを含む）
2. 暴力: 物語上の必然性を欠く、残虐行為の詳細な描写
3. 差別: 特定の人種・民族・国籍・性別・性的指向・障害・出自・信仰に対する
   侮蔑や憎悪の扇動。登場人物の台詞として差別が描かれること自体は、
   作品がそれを肯定していなければ違反ではありません
4. 違法の助長: 実行可能な手順を伴う犯罪・薬物・武器の製造方法
5. 自傷の誘引: 自殺や自傷の方法の具体的な記述、それを勧める内容
6. 個人情報: 実在する個人を特定できる住所・電話番号・勤務先など

【判定】
- none   : 上記に当たらない
- mild   : 判断に迷う。人が確認したほうがよい
- severe : 明らかに上記に当たる

【出力】
次の JSON だけを出力してください。説明文は書かないでください。
{"level":"none|mild|severe","categories":["該当した番号の名前"],"reason":"日本語で1文"}`;

function chunk(texts, limit) {
  const out = [];
  let cur = '', n = 0;
  for (const t of texts) {
    const piece = String(t).slice(0, limit);   // 1件が長すぎる場合は頭だけ
    if (cur && cur.length + piece.length + 2 > limit) { out.push(cur); cur = ''; n++; }
    cur += (cur ? '\n\n' : '') + piece;
    if (out.length >= MAX_CALLS) break;
  }
  if (cur) out.push(cur);
  return out.slice(0, MAX_CALLS);
}

/** モデルの答えから JSON を取り出す。前後に説明が付くことがあるため。 */
function parseVerdict(raw) {
  if (!raw) return null;
  let s = String(raw);
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const lv = String(o.level || '').toLowerCase();
    if (['none', 'mild', 'severe'].indexOf(lv) < 0) return null;
    return {
      level: lv,
      categories: Array.isArray(o.categories) ? o.categories.map(String).slice(0, 8) : [],
      reason: String(o.reason || '').slice(0, 400),
    };
  } catch (e) { return null; }
}

async function askOnce(env, text) {
  const payload = {
    messages: [
      { role: 'system', content: RUBRIC },
      { role: 'user', content: text },
    ],
    max_tokens: 300,
    temperature: 0,
  };
  for (const model of MODELS) {
    try {
      const r = await env.AI.run(model, payload);
      const out = (r && (r.response || r.result || r.text)) || '';
      const v = parseVerdict(out);
      if (v) return { ok: true, model, ...v };
      // 答えは返ったが読めなかった。次のモデルを試す。
    } catch (e) {
      // このモデルは使えなかった。次へ。
    }
  }
  return { ok: false };
}

/**
 * 文章を審査する。
 * @returns {{verdict:string, level:string, categories:string[],
 *            reasons:string[], checkedChars:number, calls:number, model:string|null}}
 */
export async function moderateTexts(env, texts) {
  const base = {
    verdict: VERDICT.UNKNOWN, level: 'unknown', categories: [], reasons: [],
    checkedChars: 0, calls: 0, model: null,
  };
  if (!env || !env.AI) {
    base.reasons.push('AI が使えない設定です。運営者が確認してください。');
    return base;
  }
  const list = (texts || []).filter(t => t && String(t).trim());
  if (!list.length) {
    return Object.assign(base, { verdict: VERDICT.OK, level: 'none',
      reasons: ['審査する文章がありませんでした。'] });
  }

  const parts = chunk(list, CHARS_PER_CALL);
  let worst = 'none';
  const cats = new Set(), reasons = [];
  let chars = 0, calls = 0, model = null, anyFail = false;

  for (const part of parts) {
    const v = await askOnce(env, part);
    calls++;
    chars += part.length;
    if (!v.ok) { anyFail = true; continue; }
    model = model || v.model;
    v.categories.forEach(c => cats.add(c));
    if (v.reason) reasons.push(v.reason);
    if (v.level === 'severe') worst = 'severe';
    else if (v.level === 'mild' && worst !== 'severe') worst = 'mild';
  }

  // 1つでも答えが得られなければ、素通りさせない。
  if (anyFail && worst === 'none') {
    return Object.assign(base, {
      verdict: VERDICT.UNKNOWN, level: 'unknown',
      categories: [...cats], checkedChars: chars, calls, model,
      reasons: reasons.concat(['AI が判定できなかった部分があります。運営者が確認してください。']),
    });
  }

  const verdict = worst === 'severe' ? VERDICT.BLOCK
                : worst === 'mild'   ? VERDICT.FLAG
                : VERDICT.OK;

  return {
    verdict, level: worst, categories: [...cats], reasons,
    checkedChars: chars, calls, model,
  };
}

/**
 * 下書きの審査をまとめて行い、「どう扱うべきか」まで決める。
 *
 * @param {object} env
 * @param {object|null} prevData  前に承認された版（初回は null）
 * @param {object} nextData       今回の版
 * @returns {{verdict, level, categories, reasons, diff, needsHuman:boolean,
 *            canAutoPublish:boolean, checkedChars, calls, model, at}}
 */
export async function reviewDraft(env, prevData, nextData) {
  const diff = diffDraft(prevData, nextData);

  // 初回は全文、編集は増えた行と変わった行だけ
  const targets = diff.isFirst
    ? itemsOf(nextData).map(textOf).filter(t => t.trim())
    : diff.added.concat(diff.changed);

  const r = await moderateTexts(env, targets);

  // 画像が増えていたら、AI の答えに関係なく人が見る。
  const imageAdded = diff.newMedia.length > 0;
  const reasons = r.reasons.slice();
  if (imageAdded) {
    reasons.push('画像または動画が' + diff.newMedia.length + '点増えています。画像は AI では判定しないため、運営者が確認してください。');
  }

  const needsHuman = imageAdded
    || r.verdict === VERDICT.FLAG
    || r.verdict === VERDICT.BLOCK
    || r.verdict === VERDICT.UNKNOWN;

  return {
    verdict: r.verdict,
    level: r.level,
    categories: r.categories,
    reasons,
    diff: {
      isFirst: diff.isFirst,
      added: diff.added.length,
      changed: diff.changed.length,
      removed: diff.removedCount,
      newMedia: diff.newMedia.length,
      chars: diff.totalChars,
    },
    needsHuman,
    // 自動で公開してよいのは「編集」かつ「AI が問題なしと言い切った」かつ
    // 「画像が増えていない」ときだけ。初回は必ず人が見る。
    canAutoPublish: !diff.isFirst && !needsHuman && r.verdict === VERDICT.OK,
    checkedChars: r.checkedChars,
    calls: r.calls,
    model: r.model,
    at: new Date().toISOString(),
  };
}
