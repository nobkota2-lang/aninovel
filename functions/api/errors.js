/**
 * アニノベル エラーログ受信 API
 * POST /api/errors
 *
 * フロント (js/error-monitor.js) は次のように送信する:
 *   { level, message, stack, url, ua, ts, build, user, breadcrumbs, extra }
 *   または pagehide 時の batch: { batch: [...] }
 *
 * Sentryと並行して(Sentry未契約時の代替として)動作。
 *
 * 必要な環境変数 / バインディング:
 *   - ERRORS_KV    KV namespace (エラーログの一時保存)
 *   - DISCORD_ERROR_WEBHOOK_URL  Discord通知 (重大エラーのみ)
 *
 * フロント側設定:
 *   window.ANINOVEL_ERROR_ENDPOINT='/api/errors';
 *   window.ANINOVEL_ERROR_SAMPLE=0.1;  // 本番は10%サンプリング推奨
 */

const ERROR_TTL_SEC = 60 * 60 * 24 * 30; // 30日

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid_json' }, 400); }

  const entries = body.batch && Array.isArray(body.batch) ? body.batch : [body];
  const accepted = [];

  for (const e of entries.slice(0, 50)) {
    if (!e || typeof e !== 'object') continue;

    const entry = {
      level: sanitize(e.level, 16),
      message: sanitize(e.message, 2000),
      stack: sanitize(e.stack, 4000),
      url: sanitize(e.url, 500),
      ua: sanitize(e.ua, 500),
      ts: e.ts || new Date().toISOString(),
      build: sanitize(e.build, 100),
      user: e.user || { id: 'anon' },
      breadcrumbs: Array.isArray(e.breadcrumbs) ? e.breadcrumbs.slice(0, 30) : [],
      extra: e.extra || null,
      ip: request.headers.get('CF-Connecting-IP'),
      country: request.headers.get('CF-IPCountry'),
      receivedAt: new Date().toISOString(),
    };

    // 重複抑制 (同一メッセージ+URLの場合)
    const sig = await sha256(`${entry.level}|${entry.message.slice(0, 100)}|${entry.url}`);

    if (env.ERRORS_KV) {
      const k = `err:${entry.ts.slice(0, 10)}:${sig.slice(0, 12)}:${crypto.randomUUID().slice(0, 8)}`;
      await env.ERRORS_KV.put(k, JSON.stringify(entry), { expirationTtl: ERROR_TTL_SEC });
      // 集計用カウンタ (シグネチャ毎、日次)
      const cntKey = `cnt:${entry.ts.slice(0, 10)}:${sig.slice(0, 12)}`;
      const cur = parseInt(await env.ERRORS_KV.get(cntKey) || '0', 10);
      await env.ERRORS_KV.put(cntKey, String(cur + 1), { expirationTtl: ERROR_TTL_SEC });
      // 初出 or 100回毎にDiscord通知
      if (env.DISCORD_ERROR_WEBHOOK_URL && entry.level === 'error' && (cur === 0 || cur % 100 === 0)) {
        notifyDiscord(entry, cur, env);
      }
    }
    accepted.push(sig.slice(0, 8));
  }

  return json({ ok: true, accepted: accepted.length });
}

// 運営者用: エラー一覧取得 (要認証)
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = request.headers.get('Authorization') || '';
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.ERRORS_KV) return json({ error: 'kv_not_configured' }, 503);

  const url = new URL(request.url);
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10));
  const day = url.searchParams.get('day') || new Date().toISOString().slice(0, 10);

  const list = await env.ERRORS_KV.list({ prefix: `err:${day}:`, limit });
  const items = [];
  for (const k of list.keys) {
    const v = await env.ERRORS_KV.get(k.name);
    if (v) { try { items.push(JSON.parse(v)); } catch (e) {} }
  }
  return json({ ok: true, count: items.length, items });
}

// ===== Helpers =====

async function notifyDiscord(entry, count, env) {
  try {
    await fetch(env.DISCORD_ERROR_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'アニノベル エラー監視',
        embeds: [{
          title: count === 0 ? '🆕 新規エラー発生' : `🔁 エラー再発 (${count + 1}回目)`,
          description: '```\n' + entry.message.slice(0, 800) + '\n```',
          color: 0xc0392b,
          fields: [
            { name: 'URL', value: entry.url || '(unknown)', inline: false },
            { name: 'ビルド', value: entry.build || '(unknown)', inline: true },
            { name: '国', value: entry.country || '?', inline: true },
            { name: 'UA抜粋', value: (entry.ua || '').slice(0, 80) || '(none)', inline: false },
            { name: '直近の操作', value: entry.breadcrumbs.slice(-3).map(b => `${b.category}: ${b.message}`).join('\n').slice(0, 800) || '(なし)', inline: false },
          ],
          timestamp: entry.ts,
        }]
      }),
    });
  } catch (e) {
    console.error('[errors] discord notify failed', e);
  }
}

async function sha256(s) {
  const bytes = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function sanitize(v, max) {
  if (v == null) return '';
  return String(v).slice(0, max);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
