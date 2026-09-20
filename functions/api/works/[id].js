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
// 書き込み (PUT / DELETE) は /api/author/works/:id へ移した。
// ここは読み取り専用。読者はログインなしで作品を開ける。
// 古いクライアントが PUT してきたら、新しい宛先を案内する。
export async function onRequestPut(context) {
  return json({
    error: 'moved',
    message: '保存先が /api/author/works/:id に変わりました。画面を再読込してください。'
  }, 308);
}

export async function onRequestDelete(context) {
  return json({
    error: 'moved',
    message: '削除先が /api/author/works/:id に変わりました。'
  }, 308);
}

