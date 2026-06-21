// functions/api/translate.js  v4 — 堅牢化版
// 翻訳エンジン: Cloudflare Workers AI  @cf/meta/m2m100-1.2b
// 劣化検出強化 + llama-3.1-8b-instruct フォールバック + 名前ローマ字化（緩い検証）
// デバッグ: ?debug=1 で AI レスポンスを返す

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...CORS };

const LANG = { en:'english', ja:'japanese', zh:'chinese', ko:'korean', es:'spanish', fr:'french', de:'german', pt:'portuguese', it:'italian' };
const ISO  = { en:'English', ja:'Japanese', zh:'Chinese', ko:'Korean', es:'Spanish', fr:'French', de:'German', pt:'Portuguese', it:'Italian' };

const MODEL = '@cf/meta/m2m100-1.2b';
const FALLBACK_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/google/gemma-3-12b-it',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
];
let _activeFallback = null; // セッション内で生きてるモデルを記憶
const CONCURRENCY = 4;
const MAX_CHARS_PER_CHUNK = 120;

export async function onRequestOptions() { return new Response(null, { headers: CORS }); }

export async function onRequestPost({ request, env }) {
  const debug = new URL(request.url).searchParams.get('debug') === '1';
  const dbg = []; // デバッグログ
  try {
    const body = await request.json().catch(() => ({}));
    const target = (body.target || 'en').toLowerCase();
    const source = (body.source || 'ja').toLowerCase();
    const title = (body.title || '').toString();
    const author = (body.author || '').toString();
    const items = Array.isArray(body.items) ? body.items.filter(i => i && i.id && typeof i.text === 'string') : [];
    const characters = Array.isArray(body.characters) ? body.characters.filter(c => c && c.id && typeof c.name === 'string' && c.name.trim()) : [];

    if (items.length === 0 && !title && characters.length === 0) return json({ error:'no_content' }, 400);
    if (target === source) return json({ title, author, items, characters, cache:'NOOP' });

    const srcLang = LANG[source] || source;
    const tgtLang = LANG[target] || target;
    const srcISO  = ISO[source]  || source;
    const tgtISO  = ISO[target]  || target;

    // キャッシュ v4（再翻訳強制）
    const KV = env.WORKS || env.WORKS_KV;

    // ===== 現行モデルを順に試して、最初に成功したモデルで実行 =====
    async function runWithFallback(payload){
      const order = _activeFallback
        ? [_activeFallback, ...FALLBACK_MODELS.filter(m=>m!==_activeFallback)]
        : FALLBACK_MODELS.slice();
      let lastErr = null;
      for (const m of order) {
        try {
          const r = await env.AI.run(m, payload);
          _activeFallback = m;
          if (debug) dbg.push({op:'fallback-model-ok', model: m});
          return { ok: true, model: m, response: r };
        } catch (e) {
          lastErr = e;
          if (debug) dbg.push({op:'fallback-model-fail', model: m, error: String(e && e.message)});
        }
      }
      return { ok: false, error: lastErr };
    }

    const canonical = JSON.stringify({ v:4, t:target, s:source, title, items:items.map(i=>[i.id,i.text]), chars:characters.map(c=>[c.id,c.name]) });
    const hash = (await sha256hex(canonical)).slice(0, 40);
    const cacheKey = `worktr6:${target}:${hash}`;

    if (KV && !debug) {
      const cached = await KV.get(cacheKey);
      if (cached) return new Response(cached, { headers: { ...JSON_HEADERS, 'X-Cache':'HIT', 'X-KV': KV === env.WORKS ? 'WORKS' : 'WORKS_KV' } });
    }
    if (!env.AI) return json({ error:'not_configured', message:'AI binding missing' }, 500);

    // ===== 文分割 =====
    function splitSentences(text){
      if(!text) return [];
      const parts = [];
      let buf = '', last = 0, m;
      const re = /([\u3002\uFF01\uFF1F!?！？。]+["'\u201D\u2019\uFF02\uFF07）)\]］】]*\s*)|([\.]+\s+)/g;
      while ((m = re.exec(text)) !== null) {
        buf += text.slice(last, m.index) + m[0];
        parts.push(buf); buf = ''; last = re.lastIndex;
      }
      buf += text.slice(last);
      if (buf) parts.push(buf);
      const out = [];
      for (const s of parts) {
        if (s.length <= MAX_CHARS_PER_CHUNK) { out.push(s); continue; }
        const sub = s.split(/(?<=[、,])/);
        let acc = '';
        for (const x of sub) {
          if ((acc + x).length > MAX_CHARS_PER_CHUNK && acc) { out.push(acc); acc = x; }
          else acc += x;
        }
        if (acc) out.push(acc);
      }
      return out;
    }

    // ===== 劣化検出（強化）=====
    function isDegenerate(s, original){
      if (!s) return true;
      const t = s.trim();
      if (!t) return true;
      // 末尾が中途半端な前置詞/不完全な文
      if (/\b(?:to|of|in|on|at|for|with|by|from|the|a|an|and|or|but)\.?$/i.test(t)) return true;
      // 同じ3〜12語フレーズが3回以上連続
      if (/(\b[\w'-]{1,40}(?:\s+[\w'-]{1,40}){1,11}\b)([,\s.;!?]+\1){2,}/i.test(t)) return true;
      // 同じ単語が3回以上連続
      if (/\b(\w{2,})\b(?:[,\s.;!?]+\b\1\b){2,}/i.test(t)) return true;
      // ユニーク語率
      const tokens = t.toLowerCase().match(/[a-z]+/g) || [];
      if (tokens.length >= 10) {
        const uniq = new Set(tokens).size;
        if (uniq / tokens.length < 0.5) return true;
      }
      // 結果が原文より極端に短い（情報欠落の兆候、ただし1〜2語の短文は除外）
      if (original && original.length >= 12 && t.length < original.length * 0.35) return true;
      return false;
    }

    // ===== llama 翻訳（フォールバック）=====
    async function llamaTranslate(text){
      const res = await runWithFallback({
        messages: [
          { role:'system', content:`You are a literary translator. Translate the user's ${srcISO} text into natural, fluent ${tgtISO}. Preserve tone and cultural nuance (use natural idioms; never translate cultural expressions literally). Reply with ONLY the translation; no preface, no notes, no quotes.` },
          { role:'user', content:text },
        ],
        max_tokens: Math.max(200, Math.min(1024, text.length * 4)),
        temperature: 0.2,
      });
      if (!res.ok) { if (debug) dbg.push({op:'llama-translate-allfail', error: String(res.error && res.error.message)}); return text; }
      const r = res.response;
      let out = (r && (r.response != null ? r.response : r.result)) || '';
      out = String(out).trim();
      out = out.replace(/^[`"'*]+|[`"'*]+$/g, '').trim();
      out = out.replace(/^(?:translation|english|英訳|訳)[: \-]+/i, '').trim();
      return out || text;
    }

    // ===== ローマ字化（緩い検証）=====
    async function romanizeName(name){
      if (!name || !name.trim()) return name;
      if (!/[\u3040-\u30ff\u3400-\u9fff]/.test(name)) return name;
      const res = await runWithFallback({
        messages: [
          { role:'system', content:'Output ONLY Hepburn romaji for the Japanese personal name. No quotes, no markdown, no explanation, no labels. Family name first, given name second, separated by a single space. Capitalize the first letter of each name. Examples: 田中 健太 -> Tanaka Kenta. 佐藤 美咲 -> Sato Misaki. 山田太郎 -> Yamada Taro. 愛美 -> Aimi.' },
          { role:'user', content:name },
        ],
        max_tokens: 32,
        temperature: 0.0,
      });
      if (!res.ok) { if (debug) dbg.push({op:'romanize-allfail', in: name, error: String(res.error && res.error.message)}); return name; }
      const r = res.response;
      let raw = (r && (r.response != null ? r.response : r.result)) || '';
      let out = String(raw).trim();
      out = out.split(/[\r\n]+/)[0].trim();
      out = out.replace(/^[`"'*_\[\(『「]+|[`"'*_\]\)。、!?！？.,;:』」]+$/g, '').trim();
      out = out.replace(/^(?:romaji|name|hepburn|translation|romanized)[: \-]+/i, '').trim();
      if (out && /^[A-Za-z][A-Za-z \u00C0-\u017F\.\-']{0,60}$/.test(out) && !/[\u3040-\u30ff\u3400-\u9fff]/.test(out)) {
        if (debug) dbg.push({op:'romanize', in: name, raw, out, model: res.model});
        return out;
      }
      if (debug) dbg.push({op:'romanize-reject', in: name, raw, out, model: res.model});
      return name;
    }

    // ===== 1行翻訳 =====
    async function translateLine(line){
      if (!line || !line.trim()) return line;
      const sentences = splitSentences(line);
      const tr = [];
      for (const s of sentences) {
        if (!s.trim()) { tr.push(s); continue; }
        let out = s;
        try {
          const r = await env.AI.run(MODEL, { text: s, source_lang: srcLang, target_lang: tgtLang });
          out = (r && (r.translated_text != null ? r.translated_text : r.result)) || s;
        } catch (e) {
          if (debug) dbg.push({op:'m2m-error', in:s, error: String(e && e.message)});
          out = s;
        }
        if (debug) dbg.push({op:'m2m', in:s, out});
        // 劣化検出 → llama
        if (isDegenerate(out, s) || out === s) {
          const alt = await llamaTranslate(s);
          if (debug) dbg.push({op:'llama-fallback', in:s, m2m:out, llama:alt});
          if (!isDegenerate(alt, s)) out = alt;
        }
        tr.push(out);
      }
      return tr.join(' ');
    }

    async function translateText(text){
      if (!text || !text.trim()) return text;
      const lines = text.split('\n');
      const out = [];
      for (const line of lines) out.push(await translateLine(line));
      return out.join('\n');
    }

    const titleTr = title ? await translateText(title) : '';

    const charactersOut = [];
    for (const c of characters) charactersOut.push({ id:c.id, name: await romanizeName(c.name) });

    const results = new Array(items.length);
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      const tr = await Promise.all(chunk.map(it => translateText(it.text)));
      tr.forEach((t, j) => { results[i + j] = { id: chunk[j].id, text: t }; });
    }

    const out = { title: titleTr || title, author, items: results, characters: charactersOut };
    if (debug) out._debug = dbg;
    const payload = JSON.stringify(out);
    if (KV && !debug) await KV.put(cacheKey, payload, { expirationTtl: 60 * 60 * 24 * 90 }).catch(() => {});
    return new Response(payload, { headers: { ...JSON_HEADERS, 'X-Cache':'MISS', 'X-KV': KV ? (KV === env.WORKS ? 'WORKS' : 'WORKS_KV') : 'NONE', 'X-AI-Model': _activeFallback || 'none' } });
  } catch (e) {
    return json({ error:'exception', message: String((e && e.message) || e), _debug: debug?dbg:undefined }, 500);
  }
}

function json(obj, status = 200){ return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS }); }

async function sha256hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
