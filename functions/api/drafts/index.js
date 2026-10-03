/**
 * 下書きの一覧と新規作成  /api/drafts
 * ------------------------------------------------------------
 *   GET  /api/drafts          … 自分の下書き一覧 (本文は含まない)
 *   GET  /api/drafts?queue=1  … 審査待ちの一覧 (オーナーだけ)
 *   POST /api/drafts          … 新規作成 { title, description?, penName? }
 *   POST /api/drafts          … 公開済み作品の取り込み { importWorkId:'pub_xxx' }
 *
 * ここは Cloudflare Access の外にある。サイトのログイン(an_sess クッキー)で
 * 本人を確かめる。作者は Access の使い捨て番号を持っていないため。
 * オーナーは Access 経由でも、サイトのログインでも通る (_owner.js の whoAmI)。
 */

import {
  json, kv, newDraftId, readIndex, readReviewQueue, writeDraft,
  requireAuthorOrOwner, readCatalogEntry, STATUS, MAX_DRAFTS_PER_AUTHOR, MAX_BYTES,
} from '../../_drafts.js';
import { upsertWorkMeta } from '../../_d1.js';

const PUB_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

/**
 * すでに公開されている作品を、下書きとして取り込む。
 *
 * なぜ要るのか
 *   下書きの仕組みができる前に公開した作品には下書きが無い。
 *   作者から見ると、自分の作品なのに直せない。
 *
 * 作るもの
 *   status は published、publishedId はいまの公開IDのまま。
 *   publishDraft は publishedId があればそこへ上書きするので、
 *   取り込んだ作品を直して再公開しても、同じ作品が更新される。
 *   新しい作品が増えたり、読者のしおりが切れたりはしない。
 *
 *   pendingChanges は false で始める。取り込んだだけでは中身は
 *   変わっていないので、「未審査の変更あり」とは言えない。
 */
async function importPublished(context, store, gate, pubId) {
  if (!PUB_ID_RE.test(pubId)) {
    return json({ error: 'bad_work_id', message: '作品IDの形式が正しくありません。' }, 400);
  }

  // 公開中の本体を読む。ここに持ち主が入っている。
  let data = null;
  try {
    const raw = await store.get('work:' + pubId);
    if (raw) data = JSON.parse(raw);
  } catch (e) { data = null; }
  if (!data || !Array.isArray(data.content)) {
    return json({ error: 'not_found',
      message: 'その作品が見つかりませんでした。公開が取り下げられている可能性があります。' }, 404);
  }

  // 他人の作品を取り込ませない。オーナーは例外。
  const me = String(gate.who.email || '').toLowerCase();
  const owner = String(data.ownerEmail || '').toLowerCase();
  if (!gate.isOwner && owner && owner !== me) {
    return json({ error: 'forbidden', message: 'この作品を編集する権限がありません。' }, 403);
  }
  if (!gate.isOwner && !owner) {
    // 持ち主の記録が無い作品を、誰でも取り込めてはいけない。
    return json({ error: 'forbidden',
      message: 'この作品の持ち主が記録されていません。運営者にお問い合わせください。' }, 403);
  }

  const list = await readIndex(store, me);

  // すでに取り込み済みなら、そちらを案内する。二重に作らない。
  for (const e of list) {
    if (e && e.publishedId === pubId) {
      return json({ ok: true, already: true, id: e.id,
        message: 'この作品はすでに取り込まれています。' });
    }
  }
  if (list.length >= MAX_DRAFTS_PER_AUTHOR) {
    return json({ error: 'too_many',
      message: '下書きが上限 (' + MAX_DRAFTS_PER_AUTHOR + '件) に達しています。' }, 409);
  }

  const size = new TextEncoder().encode(JSON.stringify(data)).length;
  if (size > MAX_BYTES) {
    return json({ error: 'too_large',
      message: 'この作品は大きすぎて取り込めません (上限10MB)。' }, 413);
  }

  // カタログの行から、本文には入っていない見た目の情報を引き継ぐ。
  // 表紙の色や作成日をここで拾っておかないと、再公開のときに
  // 既定値で上書きされてしまう。
  const entry = (await readCatalogEntry(store, pubId)) || {};
  const now = new Date().toISOString();
  const draft = {
    id: newDraftId(),
    ownerEmail: me,
    penName: entry.author || (data.novel && data.novel.author) || '',
    title: entry.title || (data.novel && data.novel.title) || '無題の作品',
    description: entry.description || '',
    coverColor: entry.coverColor || null,
    status: STATUS.PUBLISHED,
    createdAt: entry.createdAt || now,
    updatedAt: now,
    submittedAt: null,
    reviewedAt: now,
    reviewNote: '',
    publishedId: pubId,
    pendingChanges: false,
    importedFrom: pubId,
    importedAt: now,
    data,
  };

  await writeDraft(store, draft);
  // 集計側にも、この作品に下書きが付いたことを残す。
  try {
    await upsertWorkMeta(context.env, {
      workId: pubId, draftId: draft.id, ownerEmail: me,
      title: draft.title, status: 'published',
      createdAt: draft.createdAt, publishedAt: entry.updatedAt || draft.createdAt,
    });
  } catch (e) {}

  return json({ ok: true, imported: true, id: draft.id, publishedId: pubId,
    title: draft.title,
    message: '取り込みました。編集して「変更の公開を依頼」を押すと、運営者の確認を経て差し替わります。' }, 201);
}

export async function onRequestGet(context) {
  const store = kv(context.env);
  if (!store) return json({ error: 'kv_unbound', message: 'KV が未設定です。' }, 500);

  const gate = await requireAuthorOrOwner(context);
  if (gate.deny) return gate.deny;

  const url = new URL(context.request.url);
  if (url.searchParams.get('queue')) {
    if (!gate.isOwner) {
      return json({ error: 'forbidden', message: '審査待ちの一覧はオーナーだけが見られます。' }, 403);
    }
    return json({ ok: true, queue: await readReviewQueue(store) });
  }

  return json({ ok: true, email: gate.who.email, drafts: await readIndex(store, gate.who.email) });
}

export async function onRequestPost(context) {
  const store = kv(context.env);
  if (!store) return json({ error: 'kv_unbound', message: 'KV が未設定です。' }, 500);

  const gate = await requireAuthorOrOwner(context);
  if (gate.deny) return gate.deny;

  let body = {};
  try { body = await context.request.json(); } catch (e) { body = {}; }

  // 公開済み作品の取り込み
  if (body && body.importWorkId) {
    return importPublished(context, store, gate, String(body.importWorkId).trim());
  }

  const title = String((body && body.title) || '').trim().slice(0, 200) || '新しい作品';
  const description = String((body && body.description) || '').trim().slice(0, 1000);
  const penName = String((body && body.penName) || '').trim().slice(0, 100)
    || gate.who.nickname || gate.who.email.split('@')[0];

  const existing = await readIndex(store, gate.who.email);
  if (existing.length >= MAX_DRAFTS_PER_AUTHOR) {
    return json({
      error: 'too_many',
      message: '下書きが上限 (' + MAX_DRAFTS_PER_AUTHOR + '件) に達しています。不要なものを削除してください。',
    }, 409);
  }

  const now = new Date().toISOString();
  const draft = {
    id: newDraftId(),
    ownerEmail: gate.who.email,
    penName,
    title,
    description,
    status: STATUS.DRAFT,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    reviewedAt: null,
    reviewNote: '',
    publishedId: null,
    data: {
      version: '2.2',
      novel: { title, author: penName },
      chapters: [],
      characters: [
        {
          id: 'narrator', name: 'ナレーター', shortName: 'ナ', gender: 'neutral',
          description: '物語の進行役', bubbleColor: '#F3F4F6', iconColor: '#6B7280', iconImage: null,
        },
      ],
      content: [],
    },
  };

  await writeDraft(store, draft);
  return json({ ok: true, id: draft.id, draft: { id: draft.id, title, status: draft.status } }, 201);
}
