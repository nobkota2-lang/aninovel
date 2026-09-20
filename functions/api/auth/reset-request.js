/**
 * パスワード再設定の申し込み  POST /api/auth/reset-request  { email }
 * 登録の有無にかかわらず同じ応答を返す（存在の手がかりを与えない）。
 */
import { kvOf, json, normEmail, getUser, createReset, RESET_VALID_HOURS } from '../../_authlib.js';
import { sendMail, originOf, mailReset } from '../../_mail.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: '入力が不正です' }, 400); }
  const email = normEmail(b.email);

  const u = await getUser(kv, email);
  if (u && u.status === 'approved') {
    const token = await createReset(kv, email);
    const origin = originOf(request, env);
    const m = mailReset(email, token, origin, RESET_VALID_HOURS);
    await sendMail(env, { to: email, subject: m.subject, text: m.text });
  }
  return json({ ok: true, message: 'ご登録のアドレスであれば、再設定のご案内をお送りしました。' });
}
