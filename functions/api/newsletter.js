/**
 * アニノベル ニュースレター購読 API
 * POST /api/newsletter
 *
 * フロント側 (js/newsletter.js) は次のフォーマットで送ってくる:
 *   { email, prefs:{weekly,announcements,votes}, status, ts, source }
 *
 * 必要な環境変数 / バインディング:
 *   - RESEND_API_KEY        Resend のAPIキー (env vars)
 *   - RESEND_AUDIENCE_ID    Resend のAudience ID (Optional - 一括管理する場合)
 *   - NEWSLETTER_KV         KV namespace (重複防止用)
 *   - FROM_EMAIL            送信元メール (例: noreply@aninovel.com、Resend で認証済みドメイン)
 *   - SITE_URL              サイトURL (例: https://aninovel.com)
 *
 * 設定方法:
 *   Cloudflare Pages > Settings > Environment Variables で
 *   "Production" にRESEND_API_KEY等を追加 (Encrypt推奨)
 *
 *   KV: Cloudflare Pages > Settings > Functions > KV bindings
 *       Variable name: NEWSLETTER_KV
 *       KV namespace: 事前に Workers > KV で作成
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid_json' }, 400);
  }

  // 入力バリデーション
  const email = (body.email || '').toString().trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return json({ error: 'invalid_email' }, 400);
  }

  const prefs = body.prefs || { weekly: true, announcements: true, votes: true };
  const source = (body.source || '').toString().slice(0, 200);

  // ===== 重複チェック =====
  if (env.NEWSLETTER_KV) {
    const exists = await env.NEWSLETTER_KV.get(`sub:${email}`);
    if (exists) {
      return json({
        ok: true,
        duplicate: true,
        message: '既に登録済みです。配信を停止したい場合は、配信メール最下部の「配信停止」リンクをご利用ください。'
      });
    }
  }

  // ===== Resend Audience に登録 =====
  if (env.RESEND_API_KEY && env.RESEND_AUDIENCE_ID) {
    try {
      const r = await fetch(`https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          unsubscribed: false,
          first_name: '',
          last_name: '',
        }),
      });
      if (!r.ok && r.status !== 409) { // 409=既存
        const txt = await r.text();
        console.error('[newsletter] Resend audience add failed:', r.status, txt);
        return json({ error: 'mail_provider_error' }, 502);
      }
    } catch (e) {
      console.error('[newsletter] Resend exception:', e);
      return json({ error: 'mail_provider_unreachable' }, 502);
    }
  }

  // ===== ダブルオプトイン確認メール送信 =====
  const confirmToken = await generateToken(email, env);
  const confirmUrl = `${env.SITE_URL || 'https://aninovel.com'}/api/newsletter/confirm?t=${confirmToken}`;

  if (env.RESEND_API_KEY && env.FROM_EMAIL) {
    const mail = buildConfirmEmail({ email, confirmUrl, siteUrl: env.SITE_URL });
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `アニノベル <${env.FROM_EMAIL}>`,
          to: email,
          subject: '【アニノベル】メールアドレス登録の確認',
          html: mail.html,
          text: mail.text,
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error('[newsletter] Resend send failed:', r.status, txt);
        return json({ error: 'mail_send_failed' }, 502);
      }
    } catch (e) {
      console.error('[newsletter] Resend send exception:', e);
      return json({ error: 'mail_provider_unreachable' }, 502);
    }
  }

  // ===== KVに保留状態を記録 =====
  if (env.NEWSLETTER_KV) {
    await env.NEWSLETTER_KV.put(`sub:${email}`, JSON.stringify({
      email,
      prefs,
      source,
      status: 'pending',
      ts: new Date().toISOString(),
      confirmToken,
    }), {
      expirationTtl: 60 * 60 * 24 * 7, // 1週間で確認しなければ消滅
    });
  }

  return json({
    ok: true,
    pending: true,
    message: '確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。'
  });
}

// ----- 確認エンドポイント (/api/newsletter/confirm?t=...) -----
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // /api/newsletter/confirm の処理
  if (url.pathname.endsWith('/confirm')) {
    const token = url.searchParams.get('t') || '';
    if (!token || !env.NEWSLETTER_KV) {
      return htmlResponse(buildConfirmResultHtml(false, '不正なリンクです'));
    }
    const email = await env.NEWSLETTER_KV.get(`tok:${token}`);
    if (!email) {
      return htmlResponse(buildConfirmResultHtml(false, 'リンクの期限が切れているか、無効です'));
    }
    const sub = await env.NEWSLETTER_KV.get(`sub:${email}`);
    if (sub) {
      const data = JSON.parse(sub);
      data.status = 'subscribed';
      data.confirmedAt = new Date().toISOString();
      delete data.confirmToken;
      await env.NEWSLETTER_KV.put(`sub:${email}`, JSON.stringify(data));
      await env.NEWSLETTER_KV.delete(`tok:${token}`);
    }
    return htmlResponse(buildConfirmResultHtml(true, '購読が完了しました。'));
  }

  return json({ error: 'method_not_allowed' }, 405);
}

// ===== Helpers =====

async function generateToken(email, env) {
  // ランダム16バイト + ハッシュ
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  if (env.NEWSLETTER_KV) {
    await env.NEWSLETTER_KV.put(`tok:${token}`, email, {
      expirationTtl: 60 * 60 * 24 * 7,
    });
  }
  return token;
}

function buildConfirmEmail({ email, confirmUrl, siteUrl }) {
  const site = siteUrl || 'https://aninovel.com';
  const text = `アニノベルへの登録ありがとうございます。

下記のリンクをクリックして、メールアドレス確認を完了してください。
このリンクは7日間有効です。

${confirmUrl}

このメールに心当たりがない場合は、無視してください。

──
アニノベル
${site}`;
  const html = `<!DOCTYPE html><html lang="ja"><body style="font-family:'Hiragino Sans',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#2D2A26;line-height:1.8;background:#FAF6F0">
<h1 style="font-size:22px;font-weight:600;letter-spacing:0.04em;border-bottom:2px solid #C0392B;padding-bottom:12px;margin-bottom:24px">アニノベル メール確認</h1>
<p>このたびはアニノベル ニュースレターへのご登録ありがとうございます。</p>
<p>下記のボタンをクリックして、メールアドレス確認を完了してください。<br><small style="color:#888">※リンクは <strong>7日間</strong> 有効です</small></p>
<p style="text-align:center;margin:32px 0"><a href="${confirmUrl}" style="display:inline-block;padding:14px 32px;background:#C0392B;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">✓ 登録を完了する</a></p>
<p style="font-size:13px;color:#666">ボタンが表示されない場合、次のURLをブラウザに貼り付けてください:<br><a href="${confirmUrl}" style="word-break:break-all;color:#C0392B">${confirmUrl}</a></p>
<hr style="border:none;border-top:1px solid #E2DCD4;margin:32px 0">
<p style="font-size:12px;color:#888">このメールに心当たりがない場合、何もせずこのメールを破棄してください。お客様のメールアドレスが第三者によって入力された可能性があります。</p>
<p style="font-size:12px;color:#888">──<br>アニノベル / <a href="${site}" style="color:#C0392B">${site}</a></p>
</body></html>`;
  return { text, html };
}

function buildConfirmResultHtml(ok, message) {
  const color = ok ? '#10B981' : '#C0392B';
  const icon = ok ? '✓' : '✕';
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>確認結果 | アニノベル</title></head><body style="font-family:'Hiragino Sans',sans-serif;margin:0;padding:0;background:#FAF6F0;color:#2D2A26;min-height:100vh;display:flex;align-items:center;justify-content:center">
<div style="max-width:480px;padding:48px 32px;text-align:center">
<div style="width:80px;height:80px;border-radius:50%;background:${color};color:#fff;font-size:48px;margin:0 auto 24px;display:flex;align-items:center;justify-content:center;font-weight:700">${icon}</div>
<h1 style="font-size:24px;margin:0 0 16px;font-weight:600">${ok ? '登録完了' : '確認失敗'}</h1>
<p style="color:#666;line-height:1.8;margin:0 0 32px">${message}</p>
<a href="/" style="display:inline-block;padding:12px 32px;background:#2D2A26;color:#fff;text-decoration:none;border-radius:8px">トップへ戻る</a>
</div></body></html>`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
