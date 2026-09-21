/**
 * 読み方の設定  /api/reader/profile
 * --------------------------------------------------
 * ログイン中の利用者(読者・作者)の、吹き出しの色・アイコン・声などの
 * 設定一式を保存する。端末をまたいで同じ設定で読めるようにするため。
 *
 *   GET  … 保存済みの設定一式
 *   PUT  … 設定一式を丸ごと置き換える
 *
 * 形は viewer の localStorage と同じ:
 *   { current: 'デフォルト', profiles: { 'デフォルト': { <workId>: {...} } } }
 *
 * アイコン画像を data URL で持つことがあるので、上限を 2MB にしておく。
 */
import { kvOf, json, currentUser } from '../../_authlib.js';

const MAX_BYTES = 2 * 1024 * 1024;

export async function onRequestGet(context) {
  const me = await currentUser(context.request, context.env);
  if (!me) return json({ error: 'ログインしてください。' }, 401);
  const kv = kvOf(context.env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);
  const raw = await kv.get('rprof:' + me.email);
  if (!raw) return json({ bundle: null });
  try { return json({ bundle: JSON.parse(raw) }); }
  catch (e) { return json({ bundle: null }); }
}

export async function onRequestPut(context) {
  const me = await currentUser(context.request, context.env);
  if (!me) return json({ error: 'ログインしてください。' }, 401);
  const kv = kvOf(context.env);
  if (!kv) return json({ error: 'KV 未バインド' }, 500);

  const raw = await context.request.text();
  if (raw.length > MAX_BYTES) {
    return json({ error: '設定が大きすぎます。アイコン画像を小さくしてください。' }, 413);
  }
  let b;
  try { b = JSON.parse(raw); } catch (e) { return json({ error: '形式が不正です' }, 400); }
  const bundle = b && b.bundle;
  if (!bundle || typeof bundle !== 'object' || typeof bundle.profiles !== 'object') {
    return json({ error: 'bundle.profiles が必要です' }, 400);
  }
  await kv.put('rprof:' + me.email, JSON.stringify(bundle));
  return json({ ok: true, bytes: raw.length });
}
