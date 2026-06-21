// functions/api/translate.js
// AniNovel 作品自動翻訳 API (Cloudflare Pages Function)
//
// 翻訳エンジン: Cloudflare Workers AI  @cf/meta/m2m100-1.2b
//   - 無料枠: 10,000 Neurons/日（カード登録不要）
//   - 文単位分割 + 繰り返し劣化検知 + llama-3.1-8b-instruct フォールバック で品質確保

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...CORS };

const LANG = { en:'english', ja:'japanese', zh:'chinese', ko:'korean', es:'spanish', fr:'french', de:'german', pt:'portuguese', it:'italian' };
const ISO  = { en:'English', ja:'Japanese', zh:'Chinese', ko:'Korean', es:'Spanish', fr:'French', de:'German', pt:'Portuguese', it:'Italian' };

const MODEL = '@cf/meta/m2m100-1.2b';
const FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const CONCURRENCY = 6;
const MAX_CHARS_PER_CHUNK = 120;

export async function onRequestOptions() { return new Response(null, { headers: CORS }); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const target = (body.target || 'en').toLowerCase();
    const source = (body.source || 'ja').toLowerCase();
    const title = (body.title || '').toString();
    const author = (body.author || '').toString();
    const items = Array.isArray(body.items) ? body.items.filter(i => i && i.id && typeof i.text === 'string') : [];
    const characters = Array.isArray(body.characters) ? body.characters.filter(c => c && c.id && typeof c.name === 'string' && c.name.trim()) : [];

    if (items.length === 0 && !title) return json({ error:'no_content' }, 400);
    if (target === source) return json({ title, author, items, cache:'NOOP' });

    const srcLang = LANG[source] || source;
    const tgtLang = LANG[target] || target;
    const srcISO  = ISO[source]  || source;
    const tgtISO  = ISO[target]  || target;

    // キャッシュキーは v3（壊れた翻訳の引き継ぎ防止）
    const canonical = JSON.stringify({ v:3, t:target, s:source, title, items:items.map(i=>[i.id,i.text]), chars:characters.map(c=>[c.id,c.name]) });
    const hash = (await sha256hex(canonical)).slice(0, 40);
    const cacheKey = `worktr3:${target}:${hash}`;

    if (env.WORKS_KV) {
      const cached = await env.WORKS_KV.get(cacheKey);
      if (cached) return new Response(cached, { headers: { ...JSON_HEADERS, 'X-Cache':'HIT' } });
    }
    if (!env.AI) return json({ error:'not_configured' }, 500);

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
      // 長すぎる文は読点でさらに分割
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

    // ===== 繰り返し劣化検出 =====
    function isDegenerate(s){
      if (!s) return false;
      // 同じ3〜12語フレーズが3回以上連続
      if (/(\b[\w'-]{1,40}(?:\s+[\w'-]{1,40}){1,11}\b)([,\s.;!?]+\1){2,}/i.test(s)) return true;
      // 同じ単語が4回以上連続
      if (/\b(\w{2,})\b(?:[,\s.;!?]+\b\1\b){3,}/i.test(s)) return true;
      // ユニーク語率が低い
      const tokens = s.toLowerCase().match(/[a-z\u3040-\u30ff\u4e00-\u9fff]+/g) || [];
      if (tokens.length >= 12) {
        const uniq = new Set(tokens).size;
        if (uniq / tokens.length < 0.4) return true;
      }
      return false;
    }

    // ===== llama 翻訳（フォールバック）=====
    async function llamaTranslate(text){
      try {
        const r = await env.AI.run(FALLBACK_MODEL, {
          messages: [
            { role:'system', content:`You are a professional literary translator. Translate the user's ${srcISO} text into natural, fluent ${tgtISO}. Preserve tone, register, and cultural nuance (use natural ${tgtISO} idioms where appropriate; do NOT translate cultural expressions literally). Reply with ONLY the translation; no preface, no notes, no quotes.` },
            { role:'user', content:text },
          ],
          max_tokens: Math.max(256, Math.min(1024, text.length * 4)),
        });
        let out = (r && (r.response != null ? r.response : r.result)) || '';
        out = String(out).trim().replace(/^["'`]+|["'`]+$/g, '').trim();
        return out || text;
      } catch (e) { return text; }
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
        } catch (e) { out = s; }
        if (isDegenerate(out) || !out || out === s) {
          const alt = await llamaTranslate(s);
          out = isDegenerate(alt) ? s : alt;
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

    // 登場人物名はローマ字化
    async function romanizeName(name){
      if (!name || !name.trim()) return name;
      if (!/[\u3040-\u30ff\u3400-\u9fff]/.test(name)) return name;
      try {
        const r = await env.AI.run(FALLBACK_MODEL, {
          messages: [
            { role:'system', content:'You transliterate Japanese personal names into Hepburn romaji. Reply with ONLY the romaji name, capitalized, no quotes, no notes, no explanation. Example: 愛美 -> Aimi, 山田太郎 -> Taro Yamada.' },
            { role:'user', content:name },
          ],
          max_tokens: 24,
        });
        let out = (r && (r.response != null ? r.response : r.result)) || '';
        out = String(out).trim().split('\n')[0].replace(/^["'`\s]+|["'`.。、\s]+$/g, '').trim();
        if (out && /^[A-Za-z][A-Za-z .\-]{0,30}$/.test(out)) return out;
        return name;
      } catch (e) { return name; }
    }
    const charactersOut = [];
    for (const c of characters) charactersOut.push({ id:c.id, name: await romanizeName(c.name) });

    // 本文を並列翻訳
    const results = new Array(items.length);
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      const tr = await Promise.all(chunk.map(it => translateText(it.text)));
      tr.forEach((t, j) => { results[i + j] = { id: chunk[j].id, text: t }; });
    }

    const out = { title: titleTr || title, author, items: results, characters: charactersOut };
    const payload = JSON.stringify(out);
    if (env.WORKS_KV) await env.WORKS_KV.put(cacheKey, payload, { expirationTtl: 60 * 60 * 24 * 90 }).catch(() => {});
    return new Response(payload, { headers: { ...JSON_HEADERS, 'X-Cache':'MISS' } });
  } catch (e) {
    return json({ error:'exception', message: String((e && e.message) || e) }, 500);
  }
}

function json(obj, status = 200){ return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS }); }

async function sha256hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
