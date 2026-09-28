/**
 * 公開を依頼する / 取り下げる  /api/drafts/:id/submit
 * ------------------------------------------------------------
 *   POST   … 作者が「公開を依頼」する。status を review にして審査待ちに並べる
 *   DELETE … 取り下げる。審査待ちなら依頼を撤回し、公開中なら公開も止めて
 *              status を draft に戻す。自分の作品なので承認は要らない。
 *
 * ここでは公開しない。カタログに載るのはオーナーが承認したときだけ。
 */

import {
  json, loadForReader, writeDraft, putInReview, dropFromReview,
  unpublishWorkId, STATUS,
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

  // 審査待ちでも、すでに公開されていても、作者本人なら引っ込められる。
  // 自分の書いたものを取り下げるのは作者の権利なので、
  // 公開済みの取り下げにオーナーの承認は要らない。
  let unpublished = 0;
  if (d.status === STATUS.PUBLISHED && d.publishedId) {
    unpublished = await unpublishWorkId(r.store, d.publishedId);
    d.publishedId = null;
  } else if (d.status !== STATUS.REVIEW) {
    return json({
      error: 'nothing_to_withdraw',
      message: 'いま審査待ちでも公開中でもありません（状態: ' + d.status + '）。',
    }, 409);
  }

  d.status = STATUS.DRAFT;
  d.submittedAt = null;
  await writeDraft(r.store, d);
  await dropFromReview(r.store, d.id);

  return json({ ok: true, id: d.id, status: d.status, unpublished });
}
