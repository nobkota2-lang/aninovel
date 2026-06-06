// functions/api/translate.js
// AniNovel 作品自動翻訳 API (Cloudflare Pages Function)
//
// ★クレジット課金・APIキー不要版★
// 翻訳エンジン: Cloudflare Workers AI  @cf/meta/m2m100-1.2b
//   - 無料枠: 10,000 Neurons/日（カード登録不要）/ 毎日00:00 UTCリセット
//   - KVキャッシュ併用で実消費はごく僅か
//
// POST /api/translate
//   body: { target:'en', source:'ja', title, author, items:[{id,text}] }
//   resp: { title, author, items:[{id,text}], cache:'HIT'|'MISS' }
//
// 必要なバインディング (Cloudflare Pages > Settings > Functions):
//   AI       ... Workers AI binding（変数名: AI）
//   WORKS_KV ... 既存KV namespace（翻訳キャッシュに流用）
// ※ APIキー(ANTHROPIC_API_KEY等)は不要です。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...CORS };

// m2m100 は言語名（小文字）で指定する
const LANG = {
  en: 'english', ja: 'japanese', zh: 'chinese', ko: 'korean',
  es: 'spanish', fr: 'french', de: 'german', pt: 'portuguese', it: 'italian',
};

const MODEL = '@cf/meta/m2m100-1.2b';
const CONCURRENCY = 6; // 同時翻訳数（多すぎるとレート制限に当たるため抑制）

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const target = (body.target || 'en').toLowerCase();
    const source = (body.source || 'ja').toLowerCase();
    const title = (body.title || '').toString();
    const author = (body.author || '').toString();
    const items = Array.isArray(body.items)
      ? body.items.filter(i => i && i.id && typeof i.text === 'string')
      : [];

    if (items.length === 0 && !title) {
      return json({ error: 'no_content', message: 'items or title required' }, 400);
    }
    if (target === source) {
      return json({ title, author, items, cache: 'NOOP' });
    }

    const srcLang = LANG[source] || source;
    const tgtLang = LANG[target] || target;

    // ---- 作品単位のキャッシュ（SHA-256）----
    const canonical = JSON.stringify({ t: target, s: source, title, items: items.map(i => [i.id, i.text]) });
    const hash = (await sha256hex(canonical)).slice(0, 40);
    const cacheKey = `worktr:${target}:${hash}`;

    if (env.WORKS_KV) {
      const cached = await env.WORKS_KV.get(cacheKey);
      if (cached) return new Response(cached, { headers: { ...JSON_HEADERS, 'X-Cache': 'HIT' } });
    }

    if (!env.AI) {
      return json({ error: 'not_configured', message: 'Workers AI binding "AI" is not set' }, 500);
    }

    // 1テキストを翻訳（複数行は行ごとに訳して結合し、改行を保持）
    async function translateText(text) {
      if (!text || !text.trim()) return text;
      const lines = text.split('\n');
      const out = [];
      for (const line of lines) {
        if (!line.trim()) { out.push(line); continue; }
        try {
          const r = await env.AI.run(MODEL, { text: line, source_lang: srcLang, target_lang: tgtLang });
          out.push((r && (r.translated_text != null ? r.translated_text : r.result)) || line);
        } catch (e) {
          out.push(line); // 失敗時は原文を残す
        }
      }
      return out.join('\n');
    }

    // タイトルも翻訳（著者名は固有名詞なので原文のまま保持）
    const titleTr = title ? await translateText(title) : '';

    // 本文を CONCURRENCY 件ずつ並列翻訳
    const results = new Array(items.length);
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      const tr = await Promise.all(chunk.map(it => translateText(it.text)));
      tr.forEach((t, j) => { results[i + j] = { id: chunk[j].id, text: t }; });
    }

    const out = { title: titleTr || title, author, items: results };
    const payload = JSON.stringify(out);

    if (env.WORKS_KV) {
      await env.WORKS_KV.put(cacheKey, payload, { expirationTtl: 60 * 60 * 24 * 90 }).catch(() => {});
    }
    return new Response(payload, { headers: { ...JSON_HEADERS, 'X-Cache': 'MISS' } });
  } catch (e) {
    return json({ error: 'exception', message: String((e && e.message) || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
