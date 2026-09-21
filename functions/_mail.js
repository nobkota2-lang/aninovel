/**
 * メール送信  functions/_mail.js
 * --------------------------------------------------
 * MailChannels の無料提供は 2024-06-30 で終了したため Resend を使う。
 * 無料プラン: 1日100通 / 月3000通。
 *
 * 環境変数
 *   RESEND_API_KEY        Resend の API キー
 *   MAIL_FROM             差出人  例) AniNovel <noreply@aninovel.com>
 *   ANINOVEL_OWNER_EMAIL  オーナー（承認依頼の宛先）
 *   SITE_ORIGIN           例) https://aninovel.com   (省略時はリクエストから)
 *
 * RESEND_API_KEY が未設定なら送信せず、本文をログに出して ok:false を返す。
 * 開発中や、まだ DNS を整えていない間でも動作が止まらないようにするため。
 */

export async function sendMail(env, { to, subject, text, html }) {
  const key = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'AniNovel <noreply@aninovel.com>';
  if (!key) {
    console.log('[mail] RESEND_API_KEY 未設定のため送信せず:', { to, subject });
    console.log(text || '');
    return { ok: false, skipped: true };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: Array.isArray(to) ? to : [to], subject,
        text: text || '', ...(html ? { html } : {}),
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.log('[mail] 送信失敗', r.status, body.slice(0, 200));
      return { ok: false, status: r.status, body };
    }
    return { ok: true };
  } catch (e) {
    console.log('[mail] 例外', e.message);
    return { ok: false, error: e.message };
  }
}

export function originOf(request, env) {
  if (env.SITE_ORIGIN) return String(env.SITE_ORIGIN).replace(/\/+$/, '');
  try { return new URL(request.url).origin; } catch (e) { return 'https://aninovel.com'; }
}

// ---- 文面 ----

// Worker は UTC で動くので、日時は必ず日本時間で書く。
function jst(ms) {
  try {
    return new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + ' (JST)';
  } catch (e) { return new Date(ms).toISOString(); }
}

export function mailToOwnerOnApply(app, origin) {
  return {
    subject: `[AniNovel] 作者登録の申請がありました（${app.nickname}）`,
    text:
`作者登録の申請が届きました。

  お名前     : ${app.name}
  ニックネーム: ${app.nickname}
  メール     : ${app.email}
  自己紹介   :
${(app.bio || '').replace(/^/gm, '    ')}

  申請日時   : ${jst(app.createdAt)}

承認・却下はこちらから。
  ${origin}/admin-authors.html

（このリンクは Cloudflare Access で保護されています。
  オーナーのアカウントでログインしてください）
`,
  };
}

export function mailToAuthorOnApprove(user, origin) {
  return {
    subject: '[AniNovel] 作者登録が承認されました',
    text:
`${user.nickname} 様

作者登録が承認されました。
下のページから、ご登録のメールアドレスとパスワードでログインできます。

  ${origin}/author-login.html

  ログインID : ${user.email}

パスワードをお忘れの場合は、同じページの
「パスワードを忘れた方」からお手続きください。

——
AniNovel
${origin}
`,
  };
}

export function mailToAuthorOnReject(app, origin, reason) {
  return {
    subject: '[AniNovel] 作者登録について',
    text:
`${app.nickname} 様

このたびは作者登録のお申し込みをありがとうございました。
検討の結果、今回は見送らせていただくことになりました。

${reason ? '理由：' + reason + '\n\n' : ''}またのお申し込みをお待ちしております。

——
AniNovel
${origin}
`,
  };
}

export function mailReset(email, token, origin, hours) {
  return {
    subject: '[AniNovel] パスワード再設定',
    text:
`パスワードの再設定を受け付けました。
下のリンクから新しいパスワードを設定してください。

  ${origin}/author-reset.html?token=${token}

このリンクは ${hours} 時間で使えなくなります。
一度使うと無効になります。

心当たりがない場合は、このメールを破棄してください。
パスワードは変更されません。

——
AniNovel
${origin}
`,
  };
}
