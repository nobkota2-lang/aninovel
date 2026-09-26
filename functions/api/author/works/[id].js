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

import { whoAmI, hasRole } from '../../../_owner.js';

/**
 * 作者用の書き込み口  /api/author/works/:id
 * --------------------------------------------------
 * Cloudflare Access で保護するのはこのパスだけ。
 * 読み取り (/api/works/:id の GET) は誰でも通るので、
 * 読者は今までどおりログインなしで作品を開ける。
 *
 * Access の設定:
 *   Subdomain (空) / Domain aninovel.com / Path  api/author/*
 *
 * 環境変数:
 *   ACCESS_TEAM_DOMAIN, ACCESS_AUD, ANINOVEL_OWNER_EMAIL
 *   未設定のうちは検証をせず従来どおり通す(段階導入)。
 */
async function checkOwner(context, kv, id) {
  const { request, env } = context;
  // 「オーナーか」は利用者の記録(roles)だけで決める。
  // Access の使い捨て番号でも、サイトのログインでも、同じ結論になる。
  let who = null;
  try { who = await whoAmI(request, env); } catch (e) { who = null; }
  // 誰か分からなければ書かせない。
  // 以前は Access の環境変数が未設定のとき素通ししていた。
  // この処理は /api/writer/* からも呼ばれ、そちらは Access の外にあるため、
  // 素通りさせると誰でも作品を書き換えられてしまう。
  if (!who) {
    return { deny: json({ error: 'unauthorized', message: '保存にはログインが必要です。' }, 401) };
  }
  if (!hasRole(who, 'author') && !hasRole(who, 'owner')) {
    return { deny: json({ error: 'forbidden', message: '作者かオーナーのアカウントが必要です。' }, 403) };
  }
  let ownerEmail = null;
  try {
    const prev = await kv.get('work:' + id);
    if (prev) {
      const pj = JSON.parse(prev);
      if (pj && pj.ownerEmail) ownerEmail = String(pj.ownerEmail).toLowerCase();
    }
  } catch (e) {}
  if (ownerEmail && ownerEmail !== who.email && !hasRole(who, 'owner')) {
    return { deny: json({ error: 'forbidden', message: 'この作品を編集する権限がありません。' }, 403) };
  }
  return { who: who, ownerEmail: ownerEmail };
}

/**
 * GET は確認用。Access を通ったか、誰として見えているかを返す。
 * 作品の中身は返さない(読み取りは /api/works/:id)。
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  let who = null;
  try { who = await whoAmI(request, env); } catch (e) { who = null; }
  const accessOn = !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
  return json({
    ok: true,
    accessEnabled: accessOn,
    hasToken: !!request.headers.get('Cf-Access-Jwt-Assertion'),
    email: who ? who.email : null,
    isOwner: who ? hasRole(who, 'owner') : false,
    workId: context.params.id,
  });
}

export async function onRequestPut(context) {
  const id = context.params.id;
  if (!id || !ID_RE.test(id)) {
    return json({ error: 'invalid work id: ' + String(id) + ' (allowed: starts with a letter, then [A-Za-z0-9_-], max 100 chars)' }, 400);
  }
  const kv = getKV(context.env);
  if (!kv) {
    return json({ error: 'KV namespace ("WORKS") が未バインドです' }, 500);
  }

  // ===== 作者の確認 =====
  const chk = await checkOwner(context, kv, id);
  if (chk.deny) return chk.deny;

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
  //    作者は一度刻んだら変えない。未設定なら今書いている人が作者になる。
  if (chk.ownerEmail) data.ownerEmail = chk.ownerEmail;
  else if (chk.who) data.ownerEmail = chk.who.email;
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
  const id = context.params.id;
  if (!id || !ID_RE.test(id)) {
    return json({ error: 'invalid work id: ' + String(id) + ' (allowed: starts with a letter, then [A-Za-z0-9_-], max 100 chars)' }, 400);
  }
  const kv = getKV(context.env);
  if (!kv) {
    return json({ error: 'KV namespace ("WORKS") が未バインドです' }, 500);
  }
  // 削除も作者本人かオーナーだけ
  {
    const chkD = await checkOwner(context, kv, id);
    if (chkD.deny) return chkD.deny;
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
