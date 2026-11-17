// 英語モードで日本語のまま出る文言を洗い出す
// ----------------------------------------------------------------------
// 2026-10-26 追加。
//
// 英語モードは、画面の文字を走査して辞書(I18N_DICT / I18N_FRAG)で
// 置き換える作りになっている。ボタンを押したときに出る alert / confirm /
// トーストも同じ辞書を通る。辞書に無い文言は日本語のまま出る。
//
// 目で確かめるのは無理なので、ここで機械的に数える。
//
//   node scripts/i18n-audit.mjs            … viewer.html を見る
//   node scripts/i18n-audit.mjs 別.html    … ファイルを指定する
//
// 0 件でなければ終了コード 1 を返す。
//
// 見ているもの
//   1. alert / confirm / prompt / showToast / _showProgress に渡る文字列
//   2. title= / aria-label= / placeholder= / alt= に入る文字列
//   3. .textContent = / .innerText = に代入する文字列
//
// 見ていないもの(既知の穴)
//   いったん変数に組み立ててから alert(msg) で出す形。
//   literal が alert() の括弧の中に無いので拾えない。
//   そういう箇所は _L() で丸ごと包むこと。
// ----------------------------------------------------------------------
//
// 対象
//   1. alert / confirm / prompt / showToast に渡る文字列
//   2. HTML の title= / aria-label= / placeholder= / alt= に入る文字列
//   3. .textContent = / .innerText = に入る文字列
//   4. 変数に組み立ててから alert などに渡す文字列
//
// 除外の印
//   if(英語){…}else{日本語} のように言語で分岐した日本語側の枝は、
//   日本語で正しい。検査ツールはその形を読めないので、
//   /* i18n-ok:start 理由 */ 〜 /* i18n-ok:end */ で囲んで意図を明示する。
//   印の無い日本語は従来どおり報告するので、抜け道にはならない。
//
// 判定
//   日本語を含むリテラルが
//     - _L(ja,en) / _t(...) の第1引数である        → OK(訳がある)
//     - I18N_DICT の見出しに完全一致する           → OK(走査で置き換わる)
//     - I18N_FRAG の見出しを含む                   → OK(断片で置き換わる)
//   のいずれでもなければ「英語モードで日本語のまま出る」とみなす。
import fs from 'node:fs';

const file = process.argv[2] || process.env.TARGET
  || new URL('../viewer.html', import.meta.url).pathname;
const html = fs.readFileSync(file, 'utf8');
const JA = /[぀-ヿ一-鿿]/;

// ---- 辞書を読む -----------------------------------------------------
function dictOf(name) {
  const i = html.indexOf('var ' + name + '={');
  if (i < 0) return new Set();
  let d = 0, st = false, end = i;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { end = j + 1; break; } }
  }
  const body = html.slice(i, end);
  const keys = new Set();
  // 'キー':'値' の形だけを拾う(値は見ない)
  for (const m of body.matchAll(/'((?:[^'\\]|\\.)*)'\s*:/g)) {
    // ソースに書かれたまま(\n は2文字のまま)で持つ。
    // リテラル側も同じ形で取り出すので、こうしないと複数行の文言が一致しない。
    keys.add(m[1]);
  }
  return keys;
}
const DICT = dictOf('I18N_DICT');
const FRAG = dictOf('I18N_FRAG');
console.log('辞書: DICT ' + DICT.size + ' 件 / FRAG ' + FRAG.size + ' 件\n');

// \uXXXX や \u{XXXX} の書き方の違いで取りこぼさないよう、
// 比較する前に実際の文字へ揃える(\n などの制御文字はそのまま残す)。
function norm(x) {
  return String(x)
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
const DICT_N = new Set([...DICT].map(norm));
const FRAG_N = [...FRAG].map(norm).filter(Boolean);
function covered(lit) {
  const v = norm(lit), t = v.trim();
  if (DICT_N.has(t) || DICT_N.has(v)) return 'DICT';
  for (const k of FRAG_N) if (v.includes(k)) return 'FRAG';
  return null;
}

// ---- 文字列リテラルを位置つきで列挙 ---------------------------------
function literals(src) {
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[1] !== undefined ? m[1] : m[2];
    out.push({ idx: m.index, len: m[0].length, text: raw });
  }
  return out;
}

const lineOf = (i) => html.slice(0, i).split('\n').length;

// _L( / _t( の第1引数の範囲を求め、その中のリテラルは「訳あり」と見なす。
// 第1引数が '音声'+n+'件を…' のようなつなぎ合わせのこともあるので、
// 先頭のリテラルだけを見ると後ろの断片を誤って報告してしまう。
const wrappedRanges = [];
for (const m of html.matchAll(/\b(?:_L|_t)\(/g)) {
  let d = 0, j = m.index + m[0].length - 1, end = -1, comma = -1;
  let q = null;
  for (; j < html.length && j < m.index + 6000; j++) {
    const c = html[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) { end = j; break; } }
    else if (c === ',' && d === 1 && comma < 0) comma = j;
  }
  if (end < 0) continue;
  wrappedRanges.push([m.index + m[0].length, comma > 0 ? comma : end]);
}
const wrapped = {
  has(i) { return wrappedRanges.some(r => i >= r[0] && i <= r[1]); }
};

// 言語で分岐した日本語側の枝を除く(上の「除外の印」を参照)
const okRegions = [];
{
  const re = /\/\*\s*i18n-ok:start[\s\S]*?\*\//g;
  let m;
  while ((m = re.exec(html))) {
    const e = html.indexOf('i18n-ok:end', m.index);
    okRegions.push([m.index, e < 0 ? m.index + m[0].length : e + 'i18n-ok:end'.length]);
  }
}
const inOk = (i) => okRegions.some((r) => i >= r[0] && i <= r[1]);

const lits = literals(html);
const byIdx = new Map(lits.map(l => [l.idx, l]));

// ---- 1. 対話ダイアログ / トースト -------------------------------------
const CALLS = ['alert', 'confirm', 'prompt', 'showToast', '_showProgress'];
const problems = [];
for (const fn of CALLS) {
  const re = new RegExp('(?<![\\w.$])' + fn + '\\s*\\(', 'g');
  let m;
  while ((m = re.exec(html))) {
    // 呼び出しの括弧の中を取り出す
    let d = 0, j = m.index + m[0].length - 1, end = -1;
    for (; j < html.length && j < m.index + 4000; j++) {
      const c = html[j];
      if (c === '(') d++;
      else if (c === ')') { d--; if (d === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const start = m.index + m[0].length;
    for (const l of lits) {
      if (l.idx < start || l.idx > end) continue;
      if (!JA.test(l.text)) continue;
      if (wrapped.has(l.idx) || inOk(l.idx)) continue;
      if (covered(l.text)) continue;
      problems.push({ kind: fn, line: lineOf(l.idx), text: l.text.slice(0, 70) });
    }
  }
}

// ---- 2. 属性に入る日本語 ---------------------------------------------
const attrRe = /(title|aria-label|placeholder|alt)=(?:\\?["'])([^"'\\<>]{1,120}?)(?:\\?["'])/g;
let am;
while ((am = attrRe.exec(html))) {
  const v = am[2];
  if (!JA.test(v)) continue;
  if (inOk(am.index) || covered(v)) continue;
  problems.push({ kind: am[1], line: lineOf(am.index), text: v.slice(0, 70) });
}

// ---- 3. textContent / innerText への代入 ------------------------------
for (const m of html.matchAll(/\.(?:textContent|innerText)\s*=\s*(['"])((?:[^'"\\\n]|\\.)*)\1/g)) {
  const v = m[2];
  if (!JA.test(v)) continue;
  if (inOk(m.index) || covered(v)) continue;
  problems.push({ kind: 'textContent', line: lineOf(m.index), text: v.slice(0, 70) });
}

// ---- 4. 変数に組み立ててから渡している文 --------------------------------
// これまでの穴。alert(msg) のように渡す側が変数だと、呼び出しの括弧の中に
// 日本語リテラルが無いので見逃していた。変数名をたどって代入元を調べる。
const VIA = /(?<![\w.$])(alert|confirm|prompt|showToast|_showProgress)\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
let vm2;
while ((vm2 = VIA.exec(html))) {
  const fn = vm2[1], name = vm2[2];
  const from = Math.max(0, vm2.index - 6000);
  const scope = html.slice(from, vm2.index);
  const asg = new RegExp('(?:var\\s+|let\\s+|const\\s+)?' + name.replace(/\$/g, '\\$')
                         + '\\s*(?:\\+)?=\\s*([^;\\n]{0,400})', 'g');
  let am2;
  while ((am2 = asg.exec(scope))) {
    const rhs = am2[1];
    const base = from + am2.index + am2[0].length - rhs.length;
    for (const l of literals(rhs)) {
      if (!JA.test(l.text)) continue;
      const abs = base + l.idx;
      if (wrapped.has(abs) || inOk(abs)) continue;
      if (covered(l.text)) continue;
      problems.push({ kind: fn + '\u2190変数', line: lineOf(abs), text: l.text.slice(0, 70) });
    }
  }
}

// ---- まとめ -----------------------------------------------------------
const seen = new Set();
const uniq = problems.filter(p => {
  const k = p.kind + '|' + p.text;
  if (seen.has(k)) return false;
  seen.add(k); return true;
});
uniq.sort((a, b) => a.line - b.line);

const byKind = {};
uniq.forEach(p => { byKind[p.kind] = (byKind[p.kind] || 0) + 1; });
console.log('英語モードで日本語のまま出る可能性: ' + uniq.length + ' 件');
console.log(JSON.stringify(byKind) + '\n');
uniq.forEach(p => console.log('  L' + String(p.line).padStart(5) + '  ' + p.kind.padEnd(12) + '  ' + p.text));

process.exit(uniq.length ? 1 : 0);
