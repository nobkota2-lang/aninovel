/**
 * アニノベル 投稿作品API  /api/works/:id  (バージョン管理対応版)
 * --------------------------------------------------
 * 投稿(pub_*)作品をサーバー側(Cloudflare KV)に保存・取得・削除する。
 * バージョン履歴を最大20件まで保持。
 *
 * 配置: functions/api/works/[id].js
 *
 * 必要なバインディング:
 *   KV namespace を変数名 "WORKS" でバインド (wrangler.toml と一致)
 *
 * エンドポイント:
 *   GET    /api/works/pub_xxxxx              … 作品JSON取得
 *   GET    /api/works/pub_xxxxx?versions=1   … バージョン履歴一覧取得
 *   GET    /api/works/pub_xxxxx?version=3    … 特定バージョン取得
 *   PUT    /api/works/pub_xxxxx              … 保存(新バージョン作成)
 *     PUTボディ: { "data": <作品>, "meta": <カタログ> }
 *   DELETE /api/works/pub_xxxxx              … 削除
 */

import { requireWrite } from '../../_auth.js';

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const MAX_BYTES = 10 * 1024 * 1024;
const CATALOG_KEY = '__catalog__';
const MAX_VERSIONS = 20;  // 保持するバージョン履歴の最大数

// バインディング名を両対応 (WORKS 優先、なければ WORKS_KV)
function getKV(env) {
  return env.WORKS || env.WORKS_KV || null;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function readCatalog(kv) {
  try {
    const cur = await kv.get(CATALOG_KEY);
    if (!cur) return [];
    const arr = JSON.parse(cur);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// バージョン履歴を読む
async function readVersionList(kv, id) {
  try {
    const cur = await kv.get('versions:' + id);
    if (!cur) return [];
    const arr = JSON.parse(cur);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// GET /api/works/:id
export async function onRequestGet(context) {
  const id = context.params.id;
  if (!id || !ID_RE.test(id)) {
    return json({ error: 'invalid work id: ' + String(id) + ' (allowed: starts with a letter, then [A-Za-z0-9_-], max 100 chars)' }, 400);
  }
  const kv = getKV(context.env);
  if (!kv) {
    return json({ error: 'KV namespace ("WORKS") が未バインドです' }, 500);
  }

  const url = new URL(context.request.url);

  // ?versions=1 → バージョン履歴一覧
  if (url.searchParams.get('versions')) {
    const list = await readVersionList(kv, id);
    // データ本体は含めず、メタ情報のみ返す（軽量化）
    const summary = list.map(function (v) {
      return { version: v.version, savedAt: v.savedAt, note: v.note || '' };
    });
    return json({ id: id, versions: summary });
  }

  // ?version=N → 特定バージョンを取得
  const vParam = url.searchParams.get('version');
  if (vParam) {
    const vNum = parseInt(vParam, 10);
    const list = await readVersionList(kv, id);
    const found = list.find(function (v) { return v.version === vNum; });
    if (!found) {
      return json({ error: 'version not found' }, 404);
    }
    return json({ id: id, version: vNum, data: found.data, savedAt: found.savedAt });
  }

  // 通常: 最新版を取得
  const stored = await kv.get('work:' + id);
  if (stored === null) {
    return json({ error: 'not found' }, 404);
  }
  return new Response(stored, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// PUT /api/works/:id — 保存 + バージョン履歴作成
export async function onRequestPut(context) {
  const denied = requireWrite(context);      // 作者・オーナー以外の書き込みを拒否
  if (denied) return denied;
  const id = context.params.id;
  if (!id || !ID_RE.test(id)) {
    return json({ error: 'invalid work id: ' + String(id) + ' (allowed: starts with a letter, then [A-Za-z0-9_-], max 100 chars)' }, 400);
  }
  const kv = getKV(context.env);
  if (!kv) {
    return json({ error: 'KV namespace ("WORKS") が未バインドです' }, 500);
  }

  let raw;
  try {
    raw = await context.request.text();
  } catch (e) {
    return json({ error: 'リクエストボディの読み取りに失敗しました' }, 400);
  }

  if (new TextEncoder().encode(raw).length > MAX_BYTES) {
    return json({ error: '作品データが大きすぎます (上限10MB)' }, 413);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return json({ error: '不正なJSONです' }, 400);
  }
  if (!parsed || typeof parsed !== 'object') {
    return json({ error: '作品データの形式が不正です' }, 400);
  }

  const data = (parsed.data && parsed.data.content) ? parsed.data : parsed;
  const meta = (parsed.meta && typeof parsed.meta === 'object') ? parsed.meta : null;
  const note = (parsed.note && typeof parsed.note === 'string') ? parsed.note : '';
  if (!data || !Array.isArray(data.content)) {
    return json({ error: '作品データの形式が不正です (content配列が必要)' }, 400);
  }

  // 1) 現在の最新版をバージョン履歴に退避（存在する場合）
  const versionList = await readVersionList(kv, id);
  const prevStored = await kv.get('work:' + id);
  if (prevStored !== null) {
    try {
      const prevData = JSON.parse(prevStored);
      const nextVer = versionList.length > 0
        ? Math.max.apply(null, versionList.map(function (v) { return v.version; })) + 1
        : 1;
      versionList.push({
        version: nextVer,
        savedAt: new Date().toISOString(),
        note: note,
        data: prevData,
      });
      // 最大件数を超えたら古いものを削除
      while (versionList.length > MAX_VERSIONS) {
        versionList.shift();
      }
      await kv.put('versions:' + id, JSON.stringify(versionList));
    } catch (e) {
      // 履歴保存失敗は本体保存を妨げない
    }
  }

  // 2) 作品本体を保存
  await kv.put('work:' + id, JSON.stringify(data));

  // 3) サーバーカタログを更新
  if (meta) {
    const catalog = await readCatalog(kv);
    const entry = Object.assign({}, meta, {
      id: id,
      updatedAt: new Date().toISOString(),
    });
    const idx = catalog.findIndex(function (w) { return w && w.id === id; });
    if (idx >= 0) catalog[idx] = entry;
    else catalog.push(entry);
    await kv.put(CATALOG_KEY, JSON.stringify(catalog));
  }

  const currentVersions = await readVersionList(kv, id);
  return json({
    ok: true,
    id: id,
    savedAt: new Date().toISOString(),
    versionCount: currentVersions.length,
  });
}

// DELETE /api/works/:id
export async function onRequestDelete(context) {
  const denied = requireWrite(context);      // 削除はとくに厳重に
  if (denied) return denied;
  const id = context.params.id;
  if (!id || !ID_RE.test(id)) {
    return json({ error: 'invalid work id: ' + String(id) + ' (allowed: starts with a letter, then [A-Za-z0-9_-], max 100 chars)' }, 400);
  }
  const kv = getKV(context.env);
  if (!kv) {
    return json({ error: 'KV namespace ("WORKS") が未バインドです' }, 500);
  }

  await kv.delete('work:' + id);

  const catalog = await readCatalog(kv);
  const next = catalog.filter(function (w) { return !w || w.id !== id; });
  const removed = catalog.length - next.length;
  if (removed > 0) {
    await kv.put(CATALOG_KEY, JSON.stringify(next));
  }

  return json({ ok: true, id: id, removed: removed });
}
