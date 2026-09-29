/**
 * 下書き1件の読み書き  /api/drafts/:id
 * ------------------------------------------------------------
 *   GET    /api/drafts/draft_xxx … 本文つきで取り出す
 *   PUT    /api/drafts/draft_xxx … 保存 { data, title?, description?, penName? }
 *   DELETE /api/drafts/draft_xxx … 削除 (公開済みなら公開も取り下げる)
 *
 * 読めるのは作者本人と、審査を依頼されたあとのオーナーだけ。
 * 書けるのは作者本人だけ。オーナーでも他人の下書きは書き換えない。
 *
 * KV の無料枠は1日1,000書き込みしかない。1回の保存で
 * 「本体」と「一覧」の2件を書くので、自動保存はしない。
 * 端末側では今までどおり即座に localStorage へ控えを取り、
 * サーバーへは保存ボタンを押したときだけ送る。
 */

import {
  json, loadForReader, writeDraft, removeDraft, unpublishWorkId,
  STATUS, MAX_BYTES,
} from '../../_drafts.js';
import { touchAuthored } from '../../_d1.js';

export async function onRequestGet(context) {
  const r = await loadForReader(context, context.params.id);
  if (r.deny) return r.deny;
  return json({ ok: true, mine: r.mine, draft: r.draft });
}

export async function onRequestPut(context) {
  const r = await loadForReader(context, context.params.id, { mineOnly: true });
  if (r.deny) return r.deny;

  let raw;
  try { raw = await context.request.text(); }
  catch (e) { return json({ error: 'bad_body', message: '本文を読み取れませんでした。' }, 400); }

  if (new TextEncoder().encode(raw).length > MAX_BYTES) {
    return json({ error: 'too_large', message: '作品データが大きすぎます (上限10MB)。' }, 413);
  }

  let body;
  try { body = JSON.parse(raw); }
  catch (e) { return json({ error: 'bad_json', message: 'JSON の形式が不正です。' }, 400); }
  if (!body || typeof body !== 'object') {
    return json({ error: 'bad_json', message: 'JSON の形式が不正です。' }, 400);
  }

  const data = (body.data && typeof body.data === 'object') ? body.data : null;
  if (!data || !Array.isArray(data.content)) {
    return json({ error: 'bad_data', message: '作品データの形式が不正です (content 配列が必要です)。' }, 400);
  }

  const d = r.draft;
  d.data = data;
  if (typeof body.title === 'string' && body.title.trim()) d.title = body.title.trim().slice(0, 200);
  else if (data.novel && data.novel.title) d.title = String(data.novel.title).slice(0, 200);
  if (typeof body.description === 'string') d.description = body.description.slice(0, 1000);
  if (typeof body.penName === 'string' && body.penName.trim()) d.penName = body.penName.trim().slice(0, 100);

  // 差し戻されたあとに手を入れたら、審査前の状態へ戻す。
  // 直したのに「差し戻し」のままだと、作者が何をすべきか分からなくなる。
  if (d.status === STATUS.REJECTED) {
    d.status = STATUS.DRAFT;
    d.reviewNote = '';
  }

  // すでに公開されている作品を書き換えたときは、その変更に印を付けるだけで、
  // 読者に見えるものは承認済みの版のまま変えない。
  // 初回だけ審査して、あとは編集し放題では審査の意味がないため。
  // 作者がもう一度「公開を依頼」し、承認された時点で差し替わる。
  if (d.status === STATUS.PUBLISHED || d.status === STATUS.REVIEW) {
    d.pendingChanges = true;
  }

  await writeDraft(r.store, d);

  // 「最後に作品を登録・編集した日」を残す。
  // キャンペーン終了後、3か月編集がない作者に課金する判定に使う。
  // D1 が無い間は何もしない。保存そのものは止めない。
  try { await touchAuthored(context.env, d.ownerEmail); } catch (e) {}

  return json({ ok: true, id: d.id, status: d.status, savedAt: d.updatedAt,
    pendingChanges: !!d.pendingChanges });
}

export async function onRequestDelete(context) {
  const r = await loadForReader(context, context.params.id, { mineOnly: true });
  if (r.deny) return r.deny;

  let unpublished = 0;
  if (r.draft.publishedId) {
    unpublished = await unpublishWorkId(r.store, r.draft.publishedId);
  }
  await removeDraft(r.store, r.draft.ownerEmail, r.draft.id);
  return json({ ok: true, id: r.draft.id, unpublished });
}
