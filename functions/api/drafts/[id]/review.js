/**
 * オーナーの審査  /api/drafts/:id/review
 * ------------------------------------------------------------
 *   POST { approve: true }               … 承認して公開する（再依頼なら差し替える）
 *   POST { approve: false, note: '理由' } … 差し戻す
 *       まだ公開していない作品 → rejected にして作者へ返す
 *       公開中の作品への変更   → 公開は止めず、変更だけ断る
 *   DELETE                               … 公開を中止する（読者から見えなくする）
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
    d.reviewNote = note;

    if (d.publishedId) {
      // すでに公開されている作品への「変更」を断った場合。
      // 公開そのものは止めない。読者は承認済みの版を読み続ける。
      // 公開を止めたいときは、この窓口ではなく DELETE（公開の中止）を使う。
      d.status = STATUS.PUBLISHED;
      d.pendingChanges = true;      // 直して出し直す余地を残す
      await writeDraft(r.store, d);
      await dropFromReview(r.store, d.id);
      return json({
        ok: true, id: d.id, status: d.status, note, unpublished: 0,
        keptPublished: true,
        message: '変更を差し戻しました。公開中の版はそのままです。',
      });
    }

    // まだ一度も公開されていない作品。素直に差し戻す。
    d.status = STATUS.REJECTED;
    await writeDraft(r.store, d);
    await dropFromReview(r.store, d.id);
    return json({ ok: true, id: d.id, status: d.status, note, unpublished: 0 });
  }

  const pub = await publishDraft(r.store, d);
  d.status = STATUS.PUBLISHED;
  d.publishedId = pub.pubId;
  d.pendingChanges = false;         // 承認した内容が、いま読者に見えている版
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
