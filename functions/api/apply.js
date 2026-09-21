/**
 * 作者登録の申請  POST /api/apply
 * --------------------------------------------------
 * 誰でも呼べる。Access では保護しない（まだ作者ではないため）。
 * 申請を KV に積み、オーナーへメールで知らせる。
 */
import { kvOf, json, randToken, normEmail, validEmail,
         passwordProblem, hashPassword, verifyPassword, getUser, isAuthor } from '../_authlib.js';
import { sendMail, originOf, mailToOwnerOnApply } from '../_mail.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'KV namespace ("WORKS") が未バインドです' }, 500);

  let b;
  try { b = await request.json(); }
  catch (e) { return json({ error: '入力の形式が不正です' }, 400); }

  const name = String(b.name || '').trim();
  const email = normEmail(b.email);
  const nickname = String(b.nickname || '').trim();
  const bio = String(b.bio || '').trim();
  const password = b.password;

  if (!name || name.length > 100) return json({ error: 'お名前を入力してください（100文字まで）。' }, 400);
  if (!validEmail(email)) return json({ error: 'メールアドレスの形式が正しくありません。' }, 400);
  if (!nickname || nickname.length > 50) return json({ error: 'ニックネームを入力してください（50文字まで）。' }, 400);
  if (bio.length > 1000) return json({ error: '自己紹介は1000文字までです。' }, 400);
  const pwNg = passwordProblem(password);
  if (pwNg) return json({ error: pwNg }, 400);

  // 既にアカウントがある場合
  //   作者なら断る。
  //   読者なら、同じアカウントに作者の権限を足す申請にする。
  //   本人であることを、登録済みのパスワードで確かめる。
  const exists = await getUser(kv, email);
  let existingUser = false;
  if (exists && exists.status === 'active') {
    if (isAuthor(exists)) {
      return json({ error: 'このメールアドレスは既に作者として登録されています。' }, 409);
    }
    const same = await verifyPassword(String(password || ''), exists.pw);
    if (!same) {
      return json({ error: '読者として登録済みのアドレスです。そのときのパスワードを入力してください。' }, 401);
    }
    existingUser = true;
  }
  // 審査待ちが残っていないか
  const dup = await kv.get('applyby:' + email);
  if (dup) {
    return json({ error: '既に申請を受け付けています。承認をお待ちください。' }, 409);
  }

  // 既存の読者はパスワードを取り直さない(いまのものを使う)
  const pw = existingUser ? null : await hashPassword(password);
  const id = randToken(12);
  const app = {
    id, name, email, nickname, bio,
    existingUser,
    pw,                       // 承認時にそのまま user へ移す
    status: 'pending',
    createdAt: Date.now(),
  };
  await kv.put('apply:' + id, JSON.stringify(app));
  await kv.put('applyby:' + email, id, { expirationTtl: 60 * 60 * 24 * 90 });

  // オーナーへ通知
  const origin = originOf(request, env);
  const owner = env.ANINOVEL_OWNER_EMAIL;
  let mailed = false;
  if (owner) {
    const m = mailToOwnerOnApply(app, origin);
    const r = await sendMail(env, { to: owner, subject: m.subject, text: m.text });
    mailed = !!r.ok;
  }

  return json({ ok: true, applicationId: id, mailed });
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
