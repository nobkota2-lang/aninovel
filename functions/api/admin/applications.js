/**
 * 申請の一覧と承認  /api/admin/applications
 * --------------------------------------------------
 * オーナーだけ。Cloudflare Access で保護する（Path: api/admin/*）。
 *
 *   GET                       … 申請の一覧
 *   POST { id, action, reason }
 *         action = 'approve' | 'reject'
 */
import { verifyAccess } from '../../_access.js';
import { kvOf, json, putUser, getUser } from '../../_authlib.js';
import { sendMail, originOf, mailToAuthorOnApprove, mailToAuthorOnReject } from '../../_mail.js';

async function requireOwner(context) {
  const { request, env } = context;
  let who = null;
  try { who = await verifyAccess(request, env); } catch (e) { who = null; }
  if (!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD)) {
    return { deny: json({ error: 'access_disabled', message: 'Access が未設定です。' }, 503) };
  }
  if (!who) return { deny: json({ error: 'unauthorized' }, 401) };
  if (!who.isOwner) return { deny: json({ error: 'forbidden', message: 'オーナーだけが操作できます。' }, 403) };
  return { who };
}

export async function onRequestGet(context) {
  const g = await requireOwner(context);
  if (g.deny) return g.deny;
  const kv = kvOf(context.env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  const list = await kv.list({ prefix: 'apply:' });
  const out = [];
  for (const k of list.keys) {
    const raw = await kv.get(k.name);
    if (!raw) continue;
    try {
      const a = JSON.parse(raw);
      delete a.pw;
      out.push(a);
    } catch (e) {}
  }
  out.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
  return json({ applications: out });
}

export async function onRequestPost(context) {
  const g = await requireOwner(context);
  if (g.deny) return g.deny;
  const { request, env } = context;
  const kv = kvOf(env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  let b;
  try { b = await request.json(); }
  catch (e) { return json({ error: '入力の形式が不正です' }, 400); }

  const id = String(b.id || '');
  const action = String(b.action || '');
  const reason = String(b.reason || '').slice(0, 500);
  if (!id) return json({ error: 'id がありません' }, 400);
  if (action !== 'approve' && action !== 'reject') {
    return json({ error: 'action は approve か reject です' }, 400);
  }

  const raw = await kv.get('apply:' + id);
  if (!raw) return json({ error: 'not_found' }, 404);
  let app;
  try { app = JSON.parse(raw); } catch (e) { return json({ error: 'broken' }, 500); }
  if (app.status !== 'pending') {
    return json({ error: 'already_done', status: app.status }, 409);
  }

  const origin = originOf(request, env);

  if (action === 'approve') {
    const already = await getUser(kv, app.email);
    let user;
    if (already && already.status === 'active') {
      // 既存の読者に作者の権限を足す。パスワードはそのまま。
      if (already.roles.indexOf('author') !== -1) {
        return json({ error: 'このメールアドレスは既に作者です。' }, 409);
      }
      user = already;
      user.roles = user.roles.concat(['author']);
      user.name = app.name || user.name;
      user.nickname = app.nickname || user.nickname;
      user.bio = app.bio || user.bio;
    } else {
      if (!app.pw) return json({ error: '申請にパスワードがありません。' }, 409);
      user = {
        email: app.email, name: app.name, nickname: app.nickname, bio: app.bio,
        pw: app.pw, status: 'active', roles: ['reader', 'author'],
        createdAt: Date.now(),
      };
    }
    user.status = 'active';
    user.approvedAt = Date.now();
    user.approvedBy = g.who.email;
    await putUser(kv, user);
    app.status = 'approved';
    app.decidedAt = Date.now();
    delete app.pw;
    await kv.put('apply:' + id, JSON.stringify(app));
    await kv.delete('applyby:' + app.email);

    const m = mailToAuthorOnApprove(user, origin);
    const r = await sendMail(env, { to: user.email, subject: m.subject, text: m.text });
    return json({ ok: true, action, email: user.email, mailed: !!r.ok });
  }

  app.status = 'rejected';
  app.decidedAt = Date.now();
  app.reason = reason;
  delete app.pw;
  await kv.put('apply:' + id, JSON.stringify(app));
  await kv.delete('applyby:' + app.email);

  const m = mailToAuthorOnReject(app, origin, reason);
  const r = await sendMail(env, { to: app.email, subject: m.subject, text: m.text });
  return json({ ok: true, action, mailed: !!r.ok });
}
