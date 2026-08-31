// functions/api/characters.js — 登場人物リストのAI監修
// POST { title, author, names: [{name, count}], sample } 
// → { ok:true, keep:["主人","吾輩",...], merge:{"迷亭君":"迷亭","迷亭先生":"迷亭"} }
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
  const title = (body.title||'').slice(0,60);
  const author = (body.author||'').slice(0,30);
  const names = Array.isArray(body.names) ? body.names.slice(0,60) : [];
  const sample = (body.sample||'').slice(0,2500);
  if(!names.length) return json({ok:false, reason:'empty'}, 400);
  const nameList = names.map(function(n){return n.name+'('+(n.count||0)+'回)';}).join('、');
  const sys = 'あなたは日本語小説の登場人物整理の専門家。回答は指定されたJSONのみを出力する。';
  const user =
    '小説「'+title+'」'+(author?('('+author+'著)'):'')+'の取り込み処理で、話者として検出された候補リストです(括弧内はセリフ数)。\n\n'+
    '候補: '+nameList+'\n\n'+
    (sample?('本文冒頭の抜粋:\n'+sample+'\n\n'):'')+
    '次の2つを行ってください。\n'+
    '1. 実在の登場人物(人間のほか、擬人化された猫・動物・妖怪など話す存在を含む)だけを残し、人物でない語(一般名詞・物・概念・文の断片)を除外する。\n'+
    '2. 同一人物の表記ゆれ(例: 迷亭/迷亭君/迷亭先生)は、最も代表的な1つに統合する。\n\n'+
    '回答は次のJSON形式のみ。他の文章は一切書かない:\n'+
    '{"keep":["名前1","名前2"],"merge":{"別表記":"統合先","別表記2":"統合先"}}';
  const messages = [ {role:'system',content:sys}, {role:'user',content:user} ];
  // 小さいモデルから順に試す。
  // 70B は 8B の約6倍のニューロンを消費し、この処理を先頭に置いていたために
  // 1日の無料枠(10,000)を作品数件で使い切っていた。
  // 登場人物の絞り込みと別名統合は、話者判定ほど繊細な判断を要さないため
  // 小さいモデルで足りる。呼び出し側から model を指定することもできる。
  const MODEL_ALIAS = {
    '70b': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '8b':  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
    '3b':  '@cf/meta/llama-3.2-3b-instruct',
    'gemma':'@cf/google/gemma-3-12b-it'
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
    MODELS = body.strict ? [one] : [one].concat(DEFAULT_MODELS.filter(m => m !== one));
  } else {
    MODELS = DEFAULT_MODELS;
  }
  let res=null, lastErr=null, usedModel=null;
  for (const model of MODELS) {
    usedModel = model;
    try { res = await env.AI.run(model, { messages: messages, max_tokens: 800, temperature: 0.1 }); if(res) break; }
    catch(e){ lastErr=e; res=null; }
  }
  try {
    if(!res) throw (lastErr||new Error('all models failed'));
    function pickText(o){
      if(o==null) return '';
      if(typeof o==='string') return o;
      try { var c=o.choices&&o.choices[0]&&o.choices[0].message&&o.choices[0].message.content; if(typeof c==='string'&&c) return c; } catch(e){}
      if(typeof o.response==='string'&&o.response) return o.response;
      if(o.result) return pickText(o.result);
      if(typeof o.text==='string'&&o.text) return o.text;
      return '';
    }
    const text = pickText(res);
    if(!text) return json({ok:false, reason:'no_text'});
    const m = text.match(/\{[\s\S]*\}/);
    if(!m) return json({ok:false, reason:'no_json', raw:text.slice(0,200)});
    let parsed;
    try { parsed = JSON.parse(m[0]); } catch(e){ return json({ok:false, reason:'bad_ai_json', raw:text.slice(0,200)}); }
    const keep = Array.isArray(parsed.keep) ? parsed.keep.map(function(s){return String(s||'').trim().slice(0,10);}).filter(Boolean) : [];
    const merge = (parsed.merge&&typeof parsed.merge==='object') ? parsed.merge : {};
    if(!keep.length) return json({ok:false, reason:'empty_keep'});
    return json({ok:true, keep:keep, merge:merge, model:usedModel});
  } catch(e) {
    const msg=(e&&e.message||'')+'';
    const quota=/quota|limit|rate|exceed|429|4006|daily free allocation|neurons/i.test(msg);
    return json({ok:false, reason: quota?'quota':'ai_error', detail: msg.slice(0,200)});
  }
}