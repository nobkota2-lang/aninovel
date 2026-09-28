/**
 * 下書きの一覧と新規作成  /api/drafts
 * ------------------------------------------------------------
 *   GET  /api/drafts          … 自分の下書き一覧 (本文は含まない)
 *   GET  /api/drafts?queue=1  … 審査待ちの一覧 (オーナーだけ)
 *   POST /api/drafts          … 新規作成 { title, description?, penName? }
 *
 * ここは Cloudflare Access の外にある。サイトのログイン(an_sess クッキー)で
 * 本人を確かめる。作者は Access の使い捨て番号を持っていないため。
 * オーナーは Access 経由でも、サイトのログインでも通る (_owner.js の whoAmI)。
 */

import {
  json, kv, newDraftId, readIndex, readReviewQueue, writeDraft,
  requireAuthorOrOwner, STATUS, MAX_DRAFTS_PER_AUTHOR,
} from '../../_drafts.js';

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
