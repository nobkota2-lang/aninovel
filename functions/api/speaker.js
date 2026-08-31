// functions/api/speaker.js — セリフ話者特定API (Cloudflare Workers AI)
// POST { chunk: "本文抜粋(対象セリフ直前に【1】【2】…マーカー付き)",
//        dialogues: ["セリフ1","セリフ2",...],
//        known: ["ジョバンニ","先生",...],
//        hints: ["太郎",null,...],          // regex一次推定(任意)
//        prevSpeaker: "太郎" }              // 直前チャンク最後の発言者(任意)
// → { ok:true, speakers: ["先生","ジョバンニ",...] }  (dialoguesと同順)
// AIバインディング(env.AI)必須。無料枠超過等の失敗時は { ok:false, reason:"quota" } を返す。

function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status||200,
    headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
  });
}

export function buildMessages(chunk, dialogues, known, hints, prevSpeaker){
  const numbered = dialogues.map((d,i)=>'【'+(i+1)+'】「'+String(d).slice(0,80)+'」').join('\n');
  let hintLine = '';
  if (Array.isArray(hints) && hints.some(h=>h)) {
    hintLine = '機械的な規則による仮の推定(誤りを含む可能性あり、鵜呑みにしない): ' +
      hints.map((h,i)=>'【'+(i+1)+'】'+(h||'不明')).join(' ') + '\n';
  }
  const sys = 'あなたは日本語小説の会話分析の専門家。地の文の手がかり・呼びかけ・会話の交互性・口調から各セリフの話者を厳密に特定する。回答は指定されたJSONのみを出力する。';
  const user =
    '以下の日本語小説の抜粋を読み、【1】〜【'+dialogues.length+'】のマーカーが付いたセリフそれぞれの話者(発話した人物)を特定してください。\n\n' +
    '判定ルール:\n' +
    '1. セリフ直前・直後の地の文「◯◯は…と言った」「と◯◯が答えた」が最も確実な根拠。\n' +
    '2. セリフ冒頭の「◯◯さん」「◯◯、」等の呼びかけは聞き手の名前であり、そのセリフの話者は◯◯ではない。\n' +
    '3. 二人の会話では発言者は通常交互に入れ替わる。\n' +
    '4. 一人称(僕/俺/私/わし等)や語尾の口調(〜だわ/〜じゃ/〜であります等)も人物の手がかりになる。\n' +
    '5. セリフ内で「私は◯◯です」「◯◯だったのです」のように名乗っている場合は、その◯◯自身が話者。\n' +
    '6. 会話記号は「」のほか『』の場合もある。\n' +
    '7. 登場人物リストの名前を優先して使い、本文に根拠が無い場合のみ「不明」とする。\n' +
    '8. 語り手や話者は人間とは限らない。猫・犬・妖怪・人形など擬人化された存在が話す作品では、それらも話者として名前(猫、吾輩など)で特定する。\n' +
    '9. 地の文が一人称(吾輩・私・僕など)で語られる作品では、語り手自身が発するセリフはその語り手(例: 吾輩=猫)を話者とする。作品タイトルも語り手の正体の手がかりになる。\n\n' +
    (known && known.length ? '登場人物: '+known.join('、')+'\n' : '') +
    (prevSpeaker ? 'この抜粋の直前に最後に発言した人物: '+prevSpeaker+'\n' : '') +
    hintLine + '\n' +
    '=== 本文抜粋(【n】が対象セリフ) ===\n'+chunk+'\n\n' +
    '=== 対象セリフ一覧 ===\n'+numbered+'\n\n' +
    '回答は次のJSON形式のみ。他の文章・説明・推論過程は一切書かない:\n' +
    '{"speakers":[{"n":1,"name":"人物名"},{"n":2,"name":"不明"}]}';
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ];
}

// AI返答テキストから話者配列(長さcount)を復元する。失敗時null。
// 対応形式: {"speakers":[{"n":1,"name":"X"}]} / {"speakers":["X","Y"]} / ["X","Y"]
//           / {"1":"X","2":"Y"} / 任意キー下の配列 / 末尾切れJSONのn-nameペア救済
export function extractSpeakers(text, count){
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if(!m) return null;
  let parsed;
  try { parsed = JSON.parse(m[0]); }
  catch(e){
    const pairs = [...m[0].matchAll(/"n"\s*:\s*(\d+)\s*,\s*"name"\s*:\s*"([^"]*)"/g)];
    if(!pairs.length) return null;
    const out = new Array(count).fill('不明');
    pairs.forEach(p=>{ const i=(+p[1])-1; if(i>=0&&i<count) out[i]=p[2]; });
    return out.map(s=>String(s||'不明').trim().slice(0,10));
  }
  let arr = null;
  if (Array.isArray(parsed)) arr = parsed;
  else if (Array.isArray(parsed.speakers)) arr = parsed.speakers;
  else {
    for (const k in parsed) { if (Array.isArray(parsed[k])) { arr = parsed[k]; break; } }
    if (!arr) {
      const keys = Object.keys(parsed);
      if (keys.length && keys.every(k=>/^\d+$/.test(k))) arr = keys.sort((a,b)=>a-b).map(k=>parsed[k]);
    }
  }
  if(!arr) return null;
  const out = new Array(count).fill('不明');
  const indexed = arr.length>0 && arr.every(x=>x && typeof x==='object' && (x.n!=null || x.i!=null));
  if (indexed) {
    arr.forEach(x=>{
      const i = (+(x.n!=null ? x.n : x.i))-1;
      const nm = x.name || x.speaker || x.話者 || '';
      if(i>=0 && i<count) out[i] = String(nm||'不明');
    });
  } else {
    arr.slice(0,count).forEach((x,i)=>{
      if(x && typeof x==='object') x = x.name || x.speaker || x.話者 || '不明';
      out[i] = String(x||'不明');
    });
  }
  return out.map(s=>String(s||'不明').trim().slice(0,10));
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    speakers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, name: { type: 'string' } },
        required: ['n','name']
      }
    }
  },
  required: ['speakers']
};

export async function onRequestPost(context){
  const env = context.env;
  if(!env.AI) return json({ok:false, reason:'no_ai_binding'}, 500);
  let body;
  try { body = await context.request.json(); } catch(e){ return json({ok:false, reason:'bad_json'}, 400); }
  const chunk = (body.chunk||'').slice(0, 6000);
  const dialogues = Array.isArray(body.dialogues) ? body.dialogues.slice(0, 30) : [];
  const known = Array.isArray(body.known) ? body.known.slice(0, 30) : [];
  const hints = Array.isArray(body.hints) ? body.hints.slice(0, 30) : null;
  const prevSpeaker = (typeof body.prevSpeaker==='string' && body.prevSpeaker) ? body.prevSpeaker.slice(0,10) : null;
  if(!chunk || dialogues.length===0) return json({ok:false, reason:'empty'}, 400);

  const messages = buildMessages(chunk, dialogues, known, hints, prevSpeaker);

  // モデルは呼び出し側から指定できる。指定が無ければ小さいモデルを先に試す。
  // ニューロン単価がモデルで大きく違うため(70B は 8B の約6倍)、
  // 既定を 70B にしていると1作品で1日の無料枠(10,000)を使い切る。
  const MODEL_ALIAS = {
    '70b': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '8b':  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
    '3b':  '@cf/meta/llama-3.2-3b-instruct',
    'scout':'@cf/meta/llama-4-scout-17b-16e-instruct',
    'gemma':'@cf/google/gemma-3-12b-it',
    'mistral':'@cf/mistralai/mistral-small-3.1-24b-instruct'
  };
  const DEFAULT_MODELS = [
    '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
    '@cf/meta/llama-3.2-3b-instruct',
    '@cf/google/gemma-3-12b-it',
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  ];
  let MODELS;
  if (typeof body.model === 'string' && body.model) {
    const one = MODEL_ALIAS[body.model] || body.model;
    // 指定されたモデルだけを使う。勝手に高価なモデルへ落ちないようにする
    MODELS = body.strict ? [one] : [one].concat(DEFAULT_MODELS.filter(m => m !== one));
  } else {
    MODELS = DEFAULT_MODELS;
  }
  let res = null, lastErr = null, usedModel = null;
  for (const model of MODELS) {
    usedModel = model;
    // まずJSONスキーマ強制で試し、未対応モデルなら素のまま再試行
    try {
      res = await env.AI.run(model, {
        messages: messages,
        max_tokens: 900,
        temperature: 0.1,
        response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA }
      });
      if (res) break;
    } catch(e) { lastErr = e; res = null; }
    try {
      res = await env.AI.run(model, { messages: messages, max_tokens: 900, temperature: 0.1 });
      if (res) break;
    } catch(e) { lastErr = e; res = null; }
  }
  try {
    if (!res) throw (lastErr || new Error('all models failed'));
    function pickText(o){
      if (o == null) return '';
      if (typeof o === 'string') return o;
      // OpenAI互換: choices[0].message.content
      try { var c = o.choices && o.choices[0] && o.choices[0].message && o.choices[0].message.content; if (typeof c === 'string' && c) return c; } catch(e){}
      // choices[0].text (completion形式)
      try { var ct = o.choices && o.choices[0] && o.choices[0].text; if (typeof ct === 'string' && ct) return ct; } catch(e){}
      if (typeof o.response === 'string' && o.response) return o.response;
      if (o.response && typeof o.response === 'object') { try { return JSON.stringify(o.response); } catch(e){} }
      if (o.result) return pickText(o.result);
      if (typeof o.text === 'string' && o.text) return o.text;
      if (typeof o.content === 'string' && o.content) return o.content;
      return '';
    }
    const text = pickText(res);
    if (!text) return json({ok:false, reason:'no_text', shape: JSON.stringify(res).slice(0,300)});
    const speakers = extractSpeakers(text, dialogues.length);
    if(!speakers) return json({ok:false, reason:'no_json', raw: text.slice(0,300)});
    return json({ok:true, speakers: speakers, model: usedModel});
  } catch(e) {
    const msg = (e && e.message || '')+'';
    const quota = /quota|limit|rate|exceed|429/i.test(msg);
    return json({ok:false, reason: quota?'quota':'ai_error', detail: msg.slice(0,200)});
  }
}
