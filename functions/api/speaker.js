// functions/api/speaker.js — セリフ話者特定API (Cloudflare Workers AI)
// POST { chunk: "本文抜粋", dialogues: ["セリフ1","セリフ2",...], known: ["ジョバンニ","先生",...] }
// → { ok:true, speakers: ["先生","ジョバンニ",...] }  (dialoguesと同順)
// AIバインディング(env.AI)必須。無料枠超過等の失敗時は { ok:false, reason:"quota" } を返す。

function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status||200,
    headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
  });
}

export async function onRequestPost(context){
  const env = context.env;
  if(!env.AI) return json({ok:false, reason:'no_ai_binding'}, 500);
  let body;
  try { body = await context.request.json(); } catch(e){ return json({ok:false, reason:'bad_json'}, 400); }
  const chunk = (body.chunk||'').slice(0, 6000);
  const dialogues = Array.isArray(body.dialogues) ? body.dialogues.slice(0, 30) : [];
  const known = Array.isArray(body.known) ? body.known.slice(0, 30) : [];
  if(!chunk || dialogues.length===0) return json({ok:false, reason:'empty'}, 400);

  const numbered = dialogues.map((d,i)=>(i+1)+'. 「'+String(d).slice(0,80)+'」').join('\n');
  const prompt = '以下は日本語小説の抜粋です。各セリフの話者（発話した人物）を特定してください。\n' +
    '呼びかけられている人物ではなく、話している人物を答えること。\n' +
    (known.length ? '既知の登場人物: '+known.join('、')+'\n' : '') +
    '不明な場合は「不明」と書くこと。\n\n' +
    '=== 本文抜粋 ===\n'+chunk+'\n\n' +
    '=== 話者を特定するセリフ ===\n'+numbered+'\n\n' +
    '回答は次のJSON形式のみ。他の文章は一切書かない:\n' +
    '{"speakers":["人物名1","人物名2",...]}';

  const MODELS = [
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/meta/llama-4-scout-17b-16e-instruct',
    '@cf/google/gemma-3-12b-it',
    '@cf/mistralai/mistral-small-3.1-24b-instruct',
    '@cf/meta/llama-3.2-3b-instruct'
  ];
  let res = null, lastErr = null;
  for (const model of MODELS) {
    try {
      res = await env.AI.run(model, {
        messages: [
          { role: 'system', content: 'あなたは日本語小説の話者特定を行う。回答はJSONのみ。' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 800
      });
      if (res) break;
    } catch(e) { lastErr = e; res = null; }
  }
  try {
    if (!res) throw (lastErr || new Error('all models failed'));
    const text = (res && (res.response||res.result||'')) + '';
    const m = text.match(/\{[\s\S]*\}/);
    if(!m) return json({ok:false, reason:'no_json'});
    let parsed;
    try { parsed = JSON.parse(m[0]); } catch(e){ return json({ok:false, reason:'parse_fail'}); }
    let speakers = Array.isArray(parsed.speakers) ? parsed.speakers : null;
    if(!speakers) return json({ok:false, reason:'no_speakers'});
    speakers = speakers.slice(0, dialogues.length).map(s=>String(s||'不明').trim().slice(0,10));
    while(speakers.length < dialogues.length) speakers.push('不明');
    return json({ok:true, speakers: speakers});
  } catch(e) {
    const msg = (e && e.message || '')+'';
    const quota = /quota|limit|rate|exceed|429/i.test(msg);
    return json({ok:false, reason: quota?'quota':'ai_error', detail: msg.slice(0,200)});
  }
}