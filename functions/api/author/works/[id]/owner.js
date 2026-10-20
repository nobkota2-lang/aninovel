/**
 * 作品の作者を指定する  /api/author/works/:id/owner
 * --------------------------------------------------
 * オーナーだけが呼べる。作品の ownerEmail を書き換える。
 *
 * 配置: functions/api/author/works/[id]/owner.js
 *
 *   GET  … いまの作者を返す
 *   PUT  … 作者を指定する   { "ownerEmail": "..." }
 *          ownerEmail に null か空文字を渡すと作者を外す
 *
 * このパスも Access の api/author/* に含まれるので保護される。
 */
import { requireOwner as requireOwnerCommon } from '../../../../_owner.js';
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function getKV(env) {
  return env.WORKS || env.WORKS_KV || null;
}

/* 入口の判定は _owner.js の requireOwner に寄せる。
 * 理由は api/admin/applications.js と同じ。環境変数が無いだけで
 * 503 を返していたため、「作品の作者を決める」が使えなかった。 */
async function requireOwner(context) {
  const g = await requireOwnerCommon(context);
  if (g.deny) {
    // この口に固有の言い回しに直す。何を断られたのか分かるように。
    try {
      const body = await g.deny.clone().json();
      if (body && body.error === 'forbidden') {
        return { deny: json({ error: 'forbidden',
          message: '作者の指定はオーナーだけができます。' }, 403) };
      }
    } catch (e) {}
    return g;
  }
  return { who: Object.assign({}, g.who, { isOwner: true }) };
}

export async function onRequestGet(context) {
  const id = context.params.id;
  if (!id || !ID_RE.test(id)) return json({ error: 'invalid work id' }, 400);

  const g = await requireOwner(context);
  if (g.deny) return g.deny;

  const kv = getKV(context.env);
  if (!kv) return json({ error: 'KV namespace ("WORKS") が未バインドです' }, 500);

  const raw = await kv.get('work:' + id);
  if (!raw) return json({ error: 'not_found', workId: id }, 404);

  let data;
  try { data = JSON.parse(raw); } catch (e) { return json({ error: 'broken_data' }, 500); }
  return json({
    workId: id,
    ownerEmail: data.ownerEmail || null,
    title: data.title || (data.novel && data.novel.title) || '',
  });
}

export async function onRequestPut(context) {
  const id = context.params.id;
  if (!id || !ID_RE.test(id)) return json({ error: 'invalid work id' }, 400);

  const g = await requireOwner(context);
  if (g.deny) return g.deny;

  const kv = getKV(context.env);
  if (!kv) return json({ error: 'KV namespace ("WORKS") が未バインドです' }, 500);

  let body;
  try { body = await context.request.json(); }
  catch (e) { return json({ error: 'リクエストボディが不正です' }, 400); }

  let next = body.ownerEmail;
  if (next === null || next === '' || next === undefined) next = null;
  else {
    next = String(next).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      return json({ error: 'invalid_email', message: 'メールアドレスの形式が不正です。' }, 400);
    }
  }

  const raw = await kv.get('work:' + id);
  if (!raw) return json({ error: 'not_found', workId: id }, 404);

  let data;
  try { data = JSON.parse(raw); } catch (e) { return json({ error: 'broken_data' }, 500); }

  const before = data.ownerEmail || null;
  if (next === null) delete data.ownerEmail;
  else data.ownerEmail = next;

  await kv.put('work:' + id, JSON.stringify(data));

  return json({ ok: true, workId: id, before, after: next });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
