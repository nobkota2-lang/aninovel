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
  unpublishWorkId, publishDraft, logAutoPublish, STATUS,
} from '../../../_drafts.js';
import { upsertWorkMeta } from '../../../_d1.js';
import { reviewDraft } from '../../../_moderate.js';

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
  // 公開中の作品は、書き換えたときだけ再依頼できる。
  // 変えていないのに依頼されても、審査する中身が無い。
  if (d.status === STATUS.PUBLISHED && !d.pendingChanges) {
    return json({
      error: 'no_changes',
      message: 'この作品はすでに公開中で、前回の承認から変更がありません。',
    }, 409);
  }

  // ===== AI による公序良俗チェック =====
  // 初回  … AI が見たうえで、必ず運営者が最終確認する
  // 編集  … 前に承認した版との差分を AI が見る。問題が無ければ自動で公開。
  //          疑わしい・判定できない・画像が増えた場合は運営者へ回す。
  //
  // 前に承認した版は、公開用の本体 work:<pubId> がそれにあたる。
  let prevData = null;
  if (d.publishedId) {
    try {
      const raw = await r.store.get('work:' + d.publishedId);
      if (raw) prevData = JSON.parse(raw);
    } catch (e) { prevData = null; }
  }

  let ai;
  try {
    ai = await reviewDraft(context.env, prevData, d.data);
  } catch (e) {
    // AI の呼び出しそのものが失敗した。素通りさせず、運営者へ回す。
    ai = {
      verdict: 'unknown', level: 'unknown', categories: [],
      reasons: ['AI の審査を実行できませんでした（' + ((e && e.message) || '原因不明') + '）。運営者が確認してください。'],
      diff: null, needsHuman: true, canAutoPublish: false,
      checkedChars: 0, calls: 0, model: null, at: new Date().toISOString(),
    };
  }
  d.aiReview = ai;
  d.submittedAt = new Date().toISOString();
  d.reviewNote = '';

  // ===== 明らかに不適切なものは、運営者を待たせずその場で返す =====
  if (ai.verdict === 'block') {
    d.status = d.publishedId ? STATUS.PUBLISHED : STATUS.REJECTED;
    d.reviewNote = 'AI の審査で、公開できない表現が見つかりました。'
      + (ai.categories.length ? '（' + ai.categories.join('、') + '）' : '')
      + (ai.reasons.length ? ' ' + ai.reasons[0] : '')
      + ' 該当箇所を直してから、もう一度依頼してください。';
    if (d.publishedId) d.pendingChanges = true;   // 公開中の版はそのまま
    await writeDraft(r.store, d);
    return json({
      ok: false, blocked: true, id: d.id, status: d.status,
      ai: { verdict: ai.verdict, categories: ai.categories, reasons: ai.reasons },
      message: d.reviewNote,
    }, 422);
  }

  // ===== 編集で、AI が問題なしと判断したものは自動で公開 =====
  if (ai.canAutoPublish && d.publishedId) {
    const pub = await publishDraft(r.store, d);
  // 集計のために、作品の状態と日付を D1 にも残す。D1 が無ければ何もしない。
  try { await upsertWorkMeta(context.env, pub.meta); } catch (e) {}
    d.status = STATUS.PUBLISHED;
    d.publishedId = pub.pubId;
    d.pendingChanges = false;
    d.reviewedAt = new Date().toISOString();
    d.reviewNote = '';
    d.autoPublishedAt = d.reviewedAt;
    await writeDraft(r.store, d);
    await dropFromReview(r.store, d.id);
    // 運営者があとから見直せるよう、自動公開の記録を残す
    await logAutoPublish(r.store, d, ai);
    return json({
      ok: true, id: d.id, status: d.status, autoPublished: true,
      publishedId: pub.pubId,
      ai: { verdict: ai.verdict, diff: ai.diff },
      message: '変更を公開しました。AI の確認で問題は見つかりませんでした。',
    });
  }

  // ===== それ以外は運営者の審査へ =====
  // 公開中のものを再依頼する場合、publishedId は残したままにする。
  // 審査のあいだも、すでに公開されている版は読めるようにしておくため。
  d.status = STATUS.REVIEW;
  await writeDraft(r.store, d);
  await putInReview(r.store, d);

  return json({
    ok: true, id: d.id, status: d.status, submittedAt: d.submittedAt,
    autoPublished: false,
    ai: { verdict: ai.verdict, categories: ai.categories, reasons: ai.reasons, diff: ai.diff },
    message: ai.diff && ai.diff.isFirst
      ? '公開を依頼しました。運営者の確認をお待ちください。'
      : '変更の公開を依頼しました。運営者の確認が必要な点がありましたので、確認をお待ちください。',
  });
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
