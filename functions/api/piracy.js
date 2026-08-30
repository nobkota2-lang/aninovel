/**
 * AniNovel 海賊サイト検知ビーコン  /api/piracy
 * --------------------------------------------------
 * js/anti-piracy.js が「公式ドメイン以外で動いている」ことを検知したとき、
 * ここへ知らせる。1x1 の GIF を返すだけの受け口。
 *
 * なぜ GET + 画像なのか
 *   海賊サイトから /api/reports へ POST しても、_middleware.js の
 *   オリジン検証で 403 になり通報が届かない。検知しても気づけない。
 *   <img> による取得は Origin ヘッダを送らず CORS の対象外なので、
 *   ミドルウェアの `!origin` 分岐を通って到達できる。
 *
 * 通知先 (設定してあるものだけ使う。どれも無ければログのみ):
 *   PIRACY_KV            … KV namespace。記録を残す
 *   DISCORD_WEBHOOK_URL  … reports.js と同じものを流用可
 *
 * 使い方 (クライアント側):
 *   new Image().src = '/api/piracy?h=<host>&u=<url>&r=<referrer>&c=<canary>';
 */

// 1x1 透明GIF
const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

function pixel() {
  return new Response(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Length': String(PIXEL.length),
    },
  });
}

function cut(v, n) {
  return String(v == null ? '' : v).slice(0, n);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  let u;
  try { u = new URL(request.url); } catch (e) { return pixel(); }
  const q = u.searchParams;

  const hit = {
    host: cut(q.get('h'), 200),
    url: cut(q.get('u'), 500),
    referrer: cut(q.get('r'), 500),
    canary: cut(q.get('c'), 64),
    reason: cut(q.get('why'), 64) || 'non-official-host',
    ip: request.headers.get('CF-Connecting-IP') || null,
    country: request.headers.get('CF-IPCountry') || null,
    ua: cut(request.headers.get('User-Agent'), 400),
    at: new Date().toISOString(),
  };

  // 自分のサイトから来たものは無視 (誤報を貯めない)
  const OFFICIAL = ['aninovel.com', 'www.aninovel.com', 'aninovel.pages.dev', 'localhost', '127.0.0.1'];
  const h = hit.host.toLowerCase();
  if (!h || OFFICIAL.some(function (o) { return h === o || h.endsWith('.' + o); })) {
    return pixel();
  }

  console.warn('[piracy] 公式外のホストで動作:', JSON.stringify(hit));

  // 同じホストからの通知は1日1回だけ残す (大量アクセスで埋まらないように)
  const dayKey = 'piracy:' + hit.at.slice(0, 10) + ':' + h;

  if (env.PIRACY_KV) {
    try {
      const seen = await env.PIRACY_KV.get(dayKey);
      if (seen) return pixel();                       // 今日はもう記録済み
      await env.PIRACY_KV.put(dayKey, JSON.stringify(hit), {
        expirationTtl: 60 * 60 * 24 * 365,            // 1年
      });
    } catch (e) {
      console.error('[piracy] KV write failed:', e);
    }
  }

  if (env.DISCORD_WEBHOOK_URL) {
    try {
      await fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'アニノベル 海賊サイト検知',
          embeds: [{
            title: '🏴‍☠️ 公式外のホストで動作しています',
            color: 0xc0392b,
            fields: [
              { name: 'ホスト', value: hit.host || '(不明)', inline: false },
              { name: 'URL', value: (hit.url || '(不明)').slice(0, 900), inline: false },
              { name: '参照元', value: hit.referrer || '(直接)', inline: false },
              { name: '国 / IP', value: (hit.country || '?') + ' / ' + (hit.ip || '?'), inline: true },
              { name: 'カナリア', value: hit.canary || '(なし)', inline: true },
            ],
            timestamp: hit.at,
          }],
        }),
      });
    } catch (e) {
      console.error('[piracy] Discord notify failed:', e);
    }
  }

  return pixel();
}
