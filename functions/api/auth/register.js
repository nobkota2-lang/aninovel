/**
 * 読者の新規登録  POST /api/auth/register
 *   { name, email, password, nickname }
 * 承認は要らない。確認メールのリンクを踏むと有効になる。
 */
import { kvOf, json, normEmail, validEmail, passwordProblem,
         hashPassword, getUser, putUser, createVerify, VERIFY_VALID_HOURS } from '../../_authlib.js';
import { sendMail, originOf, mailVerify } from '../../_mail.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: '入力の形式が不正です' }, 400); }

  const email = normEmail(b.email);
  const nickname = String(b.nickname || '').trim();
  const name = String(b.name || '').trim();
  if (!validEmail(email)) return json({ error: 'メールアドレスの形式が正しくありません。' }, 400);
  if (!nickname || nickname.length > 50) return json({ error: 'ニックネームを入力してください（50文字まで）。' }, 400);
  if (name.length > 100) return json({ error: 'お名前は100文字までです。' }, 400);
  const ng = passwordProblem(b.password);
  if (ng) return json({ error: ng }, 400);

  const exists = await getUser(kv, email);
  if (exists && exists.status === 'active') {
    return json({ error: 'このメールアドレスは既に登録されています。ログインしてください。' }, 409);
  }

  // 未確認のまま残っている記録は作り直す（確認メールを再送できるように）
  const user = {
    email, name, nickname, bio: '',
    pw: await hashPassword(b.password),
    status: 'unverified',
    roles: ['reader'],
    createdAt: Date.now(),
  };
  await putUser(kv, user);

  const token = await createVerify(kv, email);
  const m = mailVerify(user, token, originOf(request, env), VERIFY_VALID_HOURS);
  const r = await sendMail(env, { to: email, subject: m.subject, text: m.text });
  return json({ ok: true, mailed: !!r.ok });
}
