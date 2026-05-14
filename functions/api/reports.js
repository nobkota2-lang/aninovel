/**
 * アニノベル 通報受付 API
 * POST /api/reports
 *
 * フロント側 (js/moderation.js) は次のフォーマットを送信:
 *   { id, workId, targetType, targetId, reasonId, comment, reporter, ctx, ts }
 *
 * 必要な環境変数 / バインディング:
 *   - REPORTS_KV          KV namespace (通報の永続化)
 *   - DISCORD_WEBHOOK_URL Discord Webhook URL (運営者への即時通知)
 *   - SLACK_WEBHOOK_URL   (代替) Slack Incoming Webhook
 *   - NOTIFY_EMAIL        (代替) Resend 経由で運営者メール
 *   - RESEND_API_KEY
 *   - FROM_EMAIL
 *
 * 設定例 (Cloudflare Pages > Settings):
 *   Environment Variables (Production / Encrypted):
 *     DISCORD_WEBHOOK_URL = https://discord.com/api/webhooks/...
 *   KV Bindings:
 *     REPORTS_KV = (作成したnamespace)
 */

const REASON_LABELS = {
  copyright: '著作権侵害',
  sexual: 'わいせつ・性的に不適切',
  violence: '暴力・残虐',
  hate: '差別・ヘイト',
  harassment: '嫌がらせ・誹謗中傷',
  privacy: 'プライバシー侵害',
  spam: 'スパム・宣伝',
  illegal: '違法行為',
  minor: '未成年者に有害',
  other: 'その他',
};

const REASON_PRIORITY = {
  copyright: 'high',
  minor: 'urgent',         // 児童保護は最高優先
  sexual: 'high',
  illegal: 'high',
  violence: 'medium',
  hate: 'medium',
  harassment: 'medium',
  privacy: 'high',
  spam: 'low',
  other: 'low',
};

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid_json' }, 400); }

  // ----- バリデーション -----
  const report = {
    id: sanitize(body.id, 64) || crypto.randomUUID(),
    workId: sanitize(body.workId, 64),
    targetType: sanitize(body.targetType, 32),      // 'work' | 'content' | 'comment' | 'user'
    targetId: sanitize(body.targetId, 64),
    reasonId: sanitize(body.reasonId, 32),
    comment: sanitize(body.comment, 2000),
    reporter: {
      id: sanitize((body.reporter || {}).id, 64) || 'anon',
      email: sanitize((body.reporter || {}).email, 254),
    },
    ctx: typeof body.ctx === 'object' ? body.ctx : null,
    ts: body.ts || new Date().toISOString(),
    ip: request.headers.get('CF-Connecting-IP') || null,
    country: request.headers.get('CF-IPCountry') || null,
    ua: (request.headers.get('User-Agent') || '').slice(0, 500),
    receivedAt: new Date().toISOString(),
  };

  if (!REASON_LABELS[report.reasonId]) {
    return json({ error: 'invalid_reason' }, 400);
  }
  if (!report.targetId && !report.workId) {
    return json({ error: 'missing_target' }, 400);
  }

  const priority = REASON_PRIORITY[report.reasonId] || 'low';
  report.priority = priority;

  // ----- KV保存 (検索用に複数キーで) -----
  if (env.REPORTS_KV) {
    const ttl = 60 * 60 * 24 * 365 * 2; // 2年保存
    const key = `report:${report.receivedAt.slice(0, 10)}:${report.id}`;
    await env.REPORTS_KV.put(key, JSON.stringify(report), { expirationTtl: ttl });
    // 作品ID別インデックス
    if (report.workId) {
      const idxKey = `idx:work:${report.workId}:${report.receivedAt}:${report.id}`;
      await env.REPORTS_KV.put(idxKey, key, { expirationTtl: ttl });
    }
    // 優先度別インデックス
    const prioKey = `idx:prio:${priority}:${report.receivedAt}:${report.id}`;
    await env.REPORTS_KV.put(prioKey, key, { expirationTtl: ttl });
  }

  // ----- 即時通知 (運営者) -----
  await notify(report, env);

  return json({ ok: true, id: report.id, message: '通報を受け付けました。運営にて確認いたします。' });
}

// ----- 運営者通知: Discord → Slack → メール の順で試行 -----
async function notify(report, env) {
  const targetUrl = report.workId
    ? `${env.SITE_URL || 'https://aninovel.com'}/viewer.html?work=${encodeURIComponent(report.workId)}`
    : (env.SITE_URL || 'https://aninovel.com');

  const reasonLabel = REASON_LABELS[report.reasonId] || report.reasonId;
  const prioEmoji = report.priority === 'urgent' ? '🚨' : report.priority === 'high' ? '⚠️' : report.priority === 'medium' ? '⚡' : 'ℹ️';

  // Discord (推奨 - 個人運営なら Discord サーバーが手軽)
  if (env.DISCORD_WEBHOOK_URL) {
    try {
      await fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'アニノベル通報',
          avatar_url: `${env.SITE_URL || 'https://aninovel.com'}/icons/icon-192.svg`,
          embeds: [{
            title: `${prioEmoji} 新規通報: ${reasonLabel}`,
            color: report.priority === 'urgent' ? 0xc0392b : report.priority === 'high' ? 0xf39c12 : 0x3498db,
            fields: [
              { name: '対象', value: `[${report.targetType}/${report.targetId || report.workId}](${targetUrl})`, inline: false },
              { name: '優先度', value: report.priority, inline: true },
              { name: '通報者ID', value: report.reporter.id, inline: true },
              { name: '国', value: report.country || 'unknown', inline: true },
              { name: 'コメント', value: (report.comment || '(なし)').slice(0, 1000), inline: false },
            ],
            footer: { text: `report id: ${report.id}` },
            timestamp: report.receivedAt,
          }]
        }),
      });
    } catch (e) {
      console.error('[reports] Discord notify failed:', e);
    }
  }

  // Slack (代替)
  else if (env.SLACK_WEBHOOK_URL) {
    try {
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `${prioEmoji} 新規通報: *${reasonLabel}* (優先度: ${report.priority})`,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `${prioEmoji} *${reasonLabel}*  優先度: \`${report.priority}\`\n対象: <${targetUrl}|${report.targetType}/${report.targetId || report.workId}>` }
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*コメント:*\n${(report.comment || '(なし)').slice(0, 1500)}` }
            },
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `通報者: \`${report.reporter.id}\` / 国: ${report.country || 'unknown'} / id: \`${report.id}\`` }]
            }
          ]
        }),
      });
    } catch (e) {
      console.error('[reports] Slack notify failed:', e);
    }
  }

  // メール (代替)
  else if (env.NOTIFY_EMAIL && env.RESEND_API_KEY && env.FROM_EMAIL) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `アニノベル通報 <${env.FROM_EMAIL}>`,
          to: env.NOTIFY_EMAIL,
          subject: `${prioEmoji} [${report.priority}] 通報: ${reasonLabel}`,
          html: `<h2>${prioEmoji} 新規通報</h2>
<p><strong>理由:</strong> ${reasonLabel}<br>
<strong>優先度:</strong> ${report.priority}<br>
<strong>対象:</strong> <a href="${targetUrl}">${targetUrl}</a><br>
<strong>通報者ID:</strong> ${escapeHtml(report.reporter.id)}<br>
<strong>国:</strong> ${escapeHtml(report.country || 'unknown')}</p>
<h3>コメント</h3>
<pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap">${escapeHtml(report.comment || '(なし)')}</pre>
<hr>
<p style="font-size:11px;color:#888">report id: ${report.id} / received: ${report.receivedAt}</p>`,
        }),
      });
    } catch (e) {
      console.error('[reports] Email notify failed:', e);
    }
  }
}

// ----- 運営者用: 通報一覧取得 (要認証) -----
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // ----- 簡易認証: ADMIN_TOKEN ヘッダ照合 -----
  const auth = request.headers.get('Authorization') || '';
  const adminToken = env.ADMIN_TOKEN || null;
  if (!adminToken || auth !== `Bearer ${adminToken}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  if (!env.REPORTS_KV) return json({ error: 'kv_not_configured' }, 503);

  const prio = url.searchParams.get('priority') || '';
  const workId = url.searchParams.get('workId') || '';
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10));

  let prefix;
  if (workId) prefix = `idx:work:${workId}:`;
  else if (prio && ['urgent', 'high', 'medium', 'low'].includes(prio)) prefix = `idx:prio:${prio}:`;
  else prefix = 'report:';

  const list = await env.REPORTS_KV.list({ prefix, limit });
  const items = [];
  for (const k of list.keys) {
    const v = await env.REPORTS_KV.get(k.name);
    if (!v) continue;
    // インデックスの場合は本体を引く
    let body = v;
    if (k.name.startsWith('idx:')) {
      body = await env.REPORTS_KV.get(v);
      if (!body) continue;
    }
    try { items.push(JSON.parse(body)); } catch (e) {}
  }
  return json({ ok: true, count: items.length, items });
}

// ----- Helpers -----

function sanitize(v, max) {
  if (v == null) return '';
  return String(v).slice(0, max);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
