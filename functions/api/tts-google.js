// functions/api/tts-google.js — 英語TTS（Google Cloud Text-to-Speech / Chirp 3 HD）
//
// 契約: POST { text: string, voice?: string }
//        → audio/mpeg (MP3) バイナリを返す。/api/tts と同じ形なので、
//          ビューアの英語音声生成からそのまま差し替えて使える。
//
// 必要な設定（Cloudflare Pages → 設定 → 変数とシークレット）:
//   GOOGLE_TTS_KEY  … Google Cloud の API キー（Text-to-Speech API だけに制限したもの）
//
// 料金は Google 側で文字数課金になるので、オーナーだけが呼べるようにしている。
// 読者の再生は、生成済みの音声ファイル(/api/audio)を使うのでここを通らない。

import { requireOwner } from '../_owner.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Chirp 3 HD の英語(米国)の声。名前だけ渡されたら en-US-Chirp3-HD- を付ける。
const CHIRP3_VOICES = [
  'Achernar','Achird','Algenib','Algieba','Alnilam','Aoede','Autonoe','Callirrhoe',
  'Charon','Despina','Enceladus','Erinome','Fenrir','Gacrux','Iapetus','Kore',
  'Laomedeia','Leda','Orus','Puck','Pulcherrima','Rasalgethi','Sadachbia',
  'Sadaltager','Schedar','Sulafat','Umbriel','Vindemiatrix','Zephyr','Zubenelgenubi',
];
const DEFAULT_VOICE = 'en-US-Chirp3-HD-Charon';

function voiceName(v) {
  const s = String(v || '').trim();
  if (/^[a-z]{2}-[A-Z]{2}-Chirp3-HD-[A-Za-z]+$/.test(s)) return s;
  const hit = CHIRP3_VOICES.find((n) => n.toLowerCase() === s.toLowerCase());
  return hit ? 'en-US-Chirp3-HD-' + hit : DEFAULT_VOICE;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const o = await requireOwner(context);
  if (o.deny) return o.deny;
  if (!env.GOOGLE_TTS_KEY) return json({ error: 'GOOGLE_TTS_KEY is not set' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  const text = (body && typeof body.text === 'string') ? body.text.trim() : '';
  if (!text) return json({ error: 'text is required' }, 400);
  if (new TextEncoder().encode(text).length > 4800) return json({ error: 'text too long (max ~4800 bytes)' }, 400);

  const name = voiceName(body.voice);
  const languageCode = name.slice(0, 5);
  const url = 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(env.GOOGLE_TTS_KEY);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });
  } catch (e) {
    return json({ error: 'google fetch failed: ' + String((e && e.message) || e) }, 500);
  }
  if (!r.ok) {
    let msg = 'google http ' + r.status;
    try { const j = await r.json(); if (j && j.error && j.error.message) msg += ' ' + j.error.message; } catch {}
    // 枠・課金の問題は、呼ぶ側が「止める」と判断できる形で返す。
    const limit = r.status === 429 || /quota|billing|exceeded/i.test(msg);
    return json({ error: msg.slice(0, 400), limit, voice: name }, limit ? 429 : 500);
  }
  const j = await r.json();
  if (!j || !j.audioContent) return json({ error: 'no audioContent' }, 500);
  const bin = atob(j.audioContent);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Response(u8, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice': name, ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}
