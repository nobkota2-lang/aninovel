/**
 * アニノベル 投稿作品API  /api/works/:id
 * --------------------------------------------------
 * 投稿(pub_*)作品をサーバー側(Cloudflare KV)に保存・取得する。
 * これにより、投稿した作品が他のユーザー・他のブラウザでも閲覧できる。
 *
 * 配置: functions/api/works/[id].js   (リポジトリ直下の functions/ 内)
 *
 * 必要なバインディング:
 *   KV namespace を変数名 "WORKS_KV" でこの Pages プロジェクトにバインドする。
 *   ダッシュボード: Pages > Settings > Functions > KV namespace bindings
 *     Variable name: WORKS_KV  /  KV namespace: aninovel-works
 *
 * エンドポイント:
 *   GET  /api/works/pub_xxxxx   … 作品JSONを取得
 *   PUT  /api/works/pub_xxxxx   … 作品JSONを保存(投稿時)
 *
 * 注: CORS / OPTIONS / レート制限 は functions/_middleware.js が処理するため
 *     この Function では扱わない。
 */

// 投稿作品IDの形式 (pub_ + 英数字/アンダースコア)
const ID_RE = /^pub_[A-Za-z0-9_]{1,80}$/;

// 作品JSONの上限サイズ (KVの値上限は25MB。キャラ画像埋め込みを考慮し10MB)
const MAX_BYTES = 10 * 1024 * 1024;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// GET /api/works/:id — 作品を取得
export async function onRequestGet(context) {
  const id = context.params.id;
  if (!id || !ID_RE.test(id)) {
    return json({ error: 'invalid work id' }, 400);
  }
  if (!context.env.WORKS_KV) {
    return json({ error: 'KV namespace "WORKS_KV" が未バインドです' }, 500);
  }
  const stored = await context.env.WORKS_KV.get('work:' + id);
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

// PUT /api/works/:id — 作品を保存 (投稿時)
export async function onRequestPut(context) {
  const id = context.params.id;
  if (!id || !ID_RE.test(id)) {
    return json({ error: 'invalid work id' }, 400);
  }
  if (!context.env.WORKS_KV) {
    return json({ error: 'KV namespace "WORKS_KV" が未バインドです' }, 500);
  }

  let body;
  try {
    body = await context.request.text();
  } catch (e) {
    return json({ error: 'リクエストボディの読み取りに失敗しました' }, 400);
  }

  // サイズ制限
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > MAX_BYTES) {
    return json({
      error: '作品データが大きすぎます (上限10MB)。音声は投稿に含まれません。',
    }, 413);
  }

  // JSON妥当性チェック
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return json({ error: '不正なJSONです' }, 400);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.content)) {
    return json({ error: '作品データの形式が不正です' }, 400);
  }

  await context.env.WORKS_KV.put('work:' + id, body, {
    metadata: { updatedAt: new Date().toISOString(), bytes: bytes },
  });

  return json({ ok: true, id: id, bytes: bytes });
}
