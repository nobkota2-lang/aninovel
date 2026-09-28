/**
 * 公開を依頼する / 取り下げる  /api/drafts/:id/submit
 * ------------------------------------------------------------
 *   POST   … 作者が「公開を依頼」する。status を review にして審査待ちに並べる
 *   DELETE … 依頼を取り下げる。status を draft に戻す
 *
 * ここでは公開しない。カタログに載るのはオーナーが承認したときだけ。
 */

import {
  json, loadForReader, writeDraft, putInReview, dropFromReview, STATUS,
} from '../../../_drafts.js';

export async function onRequestPost(context) {
  const r = await loadForReader(context, context.params.id, { mineOnly: true });
  if (r.deny) return r.deny;

  const d = r.draft;
  const content = (d.data && Array.isArray(d.data.content)) ? d.data.content : [];
  if (content.length === 0) {
    return json({ error: 'empty', message: '中身のない作品は依頼できません。まず本文を書いてください。' }, 400);
  }
  if (d.status === STATUS.REVIEW) {
    return json({ ok: true, id: d.id, status: d.status, message: 'すでに審査をお待ちいただいています。' });
  }

  d.status = STATUS.REVIEW;
  d.submittedAt = new Date().toISOString();
  d.reviewNote = '';
  await writeDraft(r.store, d);
  await putInReview(r.store, d);

  return json({ ok: true, id: d.id, status: d.status, submittedAt: d.submittedAt });
}

export async function onRequestDelete(context) {
  const r = await loadForReader(context, context.params.id, { mineOnly: true });
  if (r.deny) return r.deny;

  const d = r.draft;
  if (d.status !== STATUS.REVIEW) {
    return json({ error: 'not_in_review', message: 'いま審査待ちではありません。' }, 409);
  }
  d.status = STATUS.DRAFT;
  d.submittedAt = null;
  await writeDraft(r.store, d);
  await dropFromReview(r.store, d.id);

  return json({ ok: true, id: d.id, status: d.status });
}
