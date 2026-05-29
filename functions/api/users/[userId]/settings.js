/**
 * AniNovel ユーザー設定 API  /api/users/:userId/settings
 * --------------------------------------------------
 * 読者個人設定（カスタム属性、表示設定、ブックマーク等）を
 * Cloudflare KV に保存・取得する。バージョン管理付き（最大20版）。
 *
 * 配置: functions/api/users/[userId]/settings.js
 * バインディング: WORKS (wrangler.toml と同じ)
 *
 * エンドポイント:
 *   GET    /api/users/USER_ID/settings              … 最新版取得
 *   GET    /api/users/USER_ID/settings?versions=1   … 履歴一覧
 *   GET    /api/users/USER_ID/settings?version=3    … 特定版
 *   PUT    /api/users/USER_ID/settings              … 保存+履歴
 *   DELETE /api/users/USER_ID/settings              … 削除
 */

const USER_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_VERSIONS = 20;

function getKV(env){ return env.WORKS || env.WORKS_KV || null; }
function json(o, s){ return new Response(JSON.stringify(o), { status: s||200, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' } }); }

async function readVersions(kv, uid){
  try {
    var cur = await kv.get('user:' + uid + ':versions');
    if(!cur) return [];
    var arr = JSON.parse(cur);
    return Array.isArray(arr) ? arr : [];
  } catch(e){ return []; }
}

export async function onRequestGet(context){
  const uid = context.params.userId;
  if(!uid || !USER_ID_RE.test(uid)) return json({ error: 'invalid user id' }, 400);
  const kv = getKV(context.env);
  if(!kv) return json({ error: 'KV namespace ("WORKS") が未バインド' }, 500);
  
  const url = new URL(context.request.url);
  
  // 履歴一覧
  if(url.searchParams.get('versions')){
    const list = await readVersions(kv, uid);
    return json({ userId: uid, versions: list.map(v => ({ version: v.version, savedAt: v.savedAt, note: v.note || '' })) });
  }
  
  // 特定版
  const vParam = url.searchParams.get('version');
  if(vParam){
    const vNum = parseInt(vParam, 10);
    const list = await readVersions(kv, uid);
    const found = list.find(v => v.version === vNum);
    if(!found) return json({ error: 'version not found' }, 404);
    return json({ userId: uid, version: vNum, data: found.data, savedAt: found.savedAt });
  }
  
  // 最新版
  const stored = await kv.get('user:' + uid + ':settings');
  if(stored === null) return json({ error: 'not found' }, 404);
  return new Response(stored, { status: 200, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' } });
}

export async function onRequestPut(context){
  const uid = context.params.userId;
  if(!uid || !USER_ID_RE.test(uid)) return json({ error: 'invalid user id' }, 400);
  const kv = getKV(context.env);
  if(!kv) return json({ error: 'KV namespace ("WORKS") が未バインド' }, 500);
  
  let raw;
  try { raw = await context.request.text(); } catch(e){ return json({ error: 'body read fail' }, 400); }
  if(new TextEncoder().encode(raw).length > MAX_BYTES) return json({ error: '上限5MB' }, 413);
  
  let parsed;
  try { parsed = JSON.parse(raw); } catch(e){ return json({ error: '不正なJSON' }, 400); }
  if(!parsed || typeof parsed !== 'object') return json({ error: 'object required' }, 400);
  
  const data = parsed.data || parsed;
  const note = (parsed.note && typeof parsed.note === 'string') ? parsed.note : '';
  
  // 履歴に退避
  const versionList = await readVersions(kv, uid);
  const prevStored = await kv.get('user:' + uid + ':settings');
  if(prevStored !== null){
    try {
      const prevData = JSON.parse(prevStored);
      const nextVer = versionList.length > 0 ? Math.max.apply(null, versionList.map(v => v.version)) + 1 : 1;
      versionList.push({ version: nextVer, savedAt: new Date().toISOString(), note: note, data: prevData });
      while(versionList.length > MAX_VERSIONS) versionList.shift();
      await kv.put('user:' + uid + ':versions', JSON.stringify(versionList));
    } catch(e){}
  }
  
  // 最新を保存
  await kv.put('user:' + uid + ':settings', JSON.stringify(data));
  
  const cur = await readVersions(kv, uid);
  return json({ ok: true, userId: uid, savedAt: new Date().toISOString(), versionCount: cur.length });
}

export async function onRequestDelete(context){
  const uid = context.params.userId;
  if(!uid || !USER_ID_RE.test(uid)) return json({ error: 'invalid user id' }, 400);
  const kv = getKV(context.env);
  if(!kv) return json({ error: 'KV not bound' }, 500);
  await kv.delete('user:' + uid + ':settings');
  await kv.delete('user:' + uid + ':versions');
  return json({ ok: true, userId: uid });
}
