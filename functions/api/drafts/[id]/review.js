/**
 * オーナーの審査  /api/drafts/:id/review
 * ------------------------------------------------------------
 *   POST { approve: true }               … 承認して公開する
 *   POST { approve: false, note: '理由' } … 差し戻す
 *   DELETE                               … 公開済みのものを取り下げる
 *
 * 承認したときだけ、作品が公開カタログ (__catalog__) に載る。
 * ここが「下書き」と「公開」の唯一の境目。
 */

import {
  json, loadForReader, writeDraft, dropFromReview,
  publishDraft, unpublishWorkId, STATUS,
} from '../../../_drafts.js';

function ownerOnly(r) {
  if (!r.isOwner) {
    return json({ error: 'forbidden', message: '審査はオーナーだけが行えます。' }, 403);
  }
  return null;
}

export async function onRequestPost(context) {
  const r = await loadForReader(context, context.params.id);
  if (r.deny) return r.deny;
  const no = ownerOnly(r); if (no) return no;

  let body = {};
  try { body = await context.request.json(); } catch (e) { body = {}; }
  const approve = body.approve !== false;   // 既定は承認
  const note = String((body && body.note) || '').trim().slice(0, 2000);

  const d = r.draft;
  if (d.status !== STATUS.REVIEW && d.status !== STATUS.PUBLISHED) {
    return json({
      error: 'not_in_review',
      message: 'この作品は審査待ちではありません (いまの状態: ' + d.status + ')。',
    }, 409);
  }

  d.reviewedAt = new Date().toISOString();

  if (!approve) {
    if (!note) {
      return json({ error: 'note_required', message: '差し戻すときは理由を書いてください。' }, 400);
    }
    d.status = STATUS.REJECTED;
    d.reviewNote = note;
    // 公開済みだったものを差し戻す場合は、公開も取り下げる
    let unpublished = 0;
    if (d.publishedId) {
      unpublished = await unpublishWorkId(r.store, d.publishedId);
      d.publishedId = null;
    }
    await writeDraft(r.store, d);
    await dropFromReview(r.store, d.id);
    return json({ ok: true, id: d.id, status: d.status, note, unpublished });
  }

  const pub = await publishDraft(r.store, d);
  d.status = STATUS.PUBLISHED;
  d.publishedId = pub.pubId;
  d.reviewNote = note;
  await writeDraft(r.store, d);
  await dropFromReview(r.store, d.id);

  return json({ ok: true, id: d.id, status: d.status, publishedId: pub.pubId, entry: pub.entry });
}

export async function onRequestDelete(context) {
  const r = await loadForReader(context, context.params.id);
  if (r.deny) return r.deny;
  const no = ownerOnly(r); if (no) return no;

  const d = r.draft;
  if (!d.publishedId) {
    return json({ error: 'not_published', message: 'この作品はまだ公開されていません。' }, 409);
  }
  const removed = await unpublishWorkId(r.store, d.publishedId);
  d.publishedId = null;
  d.status = STATUS.DRAFT;
  await writeDraft(r.store, d);

  return json({ ok: true, id: d.id, status: d.status, removed });
}
