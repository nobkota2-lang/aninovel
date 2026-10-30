// functions/api/tts.js — 英語TTS（Cloudflare Workers AI / Deepgram Aura）
// 契約: POST { text: string, voice?: string, model?: 'aura-1'|'aura-2-en' }
//       → audio/mpeg (MP3) バイナリを返す。
// AI バインディング（env.AI）が必要（translate.js と同じ）。
// 認証カード不要・新規アカウント不要（既存 Cloudflare Workers AI を利用）。

const AURA1_VOICES = ['angus','asteria','arcas','orion','orpheus','athena','luna','zeus','perseus','helios','hera','stella'];

// aura-2-en が受け付ける声。素通しで渡していたため、綴りが違うと
// Workers AI が enum エラーを返し、ここが 500 になっていた。
// ビューアはそれを「音声の失敗」と見て端末内蔵の音声に落ちるので、
// 1文字の違いでクラウド音声が使えなくなる。外れたら既定へ寄せる。
const AURA2_VOICES = [
  'amalthea','andromeda','apollo','arcas','aries','asteria','athena','atlas','aurora',
  'callista','cora','cordelia','delia','draco','electra','harmonia','helena','hera',
  'hermes','hyperion','iris','janus','juno','jupiter','luna','mars','minerva','neptune',
  'odysseus','ophelia','orion','orpheus','pandora','phoebe','pluto','saturn','thalia',
  'theia','vesta','zeus',
];
// aura-1 にしか無い声の移し替え。古いデータがそのまま送られてきても鳴るように。
const AURA1_TO_AURA2 = { angus: 'arcas', stella: 'asteria', perseus: 'orion', helios: 'apollo' };

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  try {
    if (!env.AI) {
      return json({ error: 'AI binding not configured' }, 500, cors);
    }
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400, cors); }
    const text = (body && typeof body.text === 'string') ? body.text.trim() : '';
    if (!text) return json({ error: 'text is required' }, 400, cors);
    if (text.length > 2000) return json({ error: 'text too long (max 2000)' }, 400, cors);

    // モデル選択: 既定は新しい Aura-2 (en)。aura-1 指定時は voice も使用可。
    const wantModel = (body && body.model) || 'aura-2-en';
    let voice = (body && typeof body.voice === 'string') ? body.voice.toLowerCase() : '';

    let modelId, input;
    if (wantModel === 'aura-1') {
      modelId = '@cf/deepgram/aura-1';
      if (!AURA1_VOICES.includes(voice)) voice = 'angus';
      input = { text, speaker: voice };
    } else {
      // aura-2-en（最新）。受け付ける名前かを必ず確かめてから渡す。
      modelId = '@cf/deepgram/aura-2-en';
      if (voice && AURA1_TO_AURA2[voice]) voice = AURA1_TO_AURA2[voice];
      if (voice && !AURA2_VOICES.includes(voice)) voice = 'asteria';
      input = voice ? { text, speaker: voice } : { text };
    }

    const resp = await env.AI.run(modelId, input);
    // env.AI.run は音声モデルで ReadableStream / ArrayBuffer / Response を返し得る。
    let audio;
    if (resp instanceof Response) {
      audio = await resp.arrayBuffer();
    } else if (resp instanceof ReadableStream) {
      audio = await new Response(resp).arrayBuffer();
    } else if (resp instanceof ArrayBuffer) {
      audio = resp;
    } else if (resp && resp.audio) {
      // base64 で返る実装の場合
      const bin = atob(resp.audio);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      audio = u8.buffer;
    } else {
      return json({ error: 'unexpected AI response' }, 502, cors);
    }

    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...cors,
      },
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500, cors);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cors || {}) },
  });
}
