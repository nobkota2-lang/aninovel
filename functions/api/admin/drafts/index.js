/**
 * 審査待ちの一覧 (オーナー用)  /api/admin/drafts
 * ------------------------------------------------------------
 * 中身は /api/drafts?queue=1 と同じ。パスを分けている理由は1つだけで、
 * Cloudflare Access が "api/admin/*" を守っているから。
 * オーナーは admin-authors.html から、Access のログインだけで審査できる。
 *
 * 作者側 (/api/drafts) は Access の外にあり、サイトのログインで通る。
 */

import { json, kv, readReviewQueue, requireAuthorOrOwner } from '../../../_drafts.js';

export async function onRequestGet(context) {
  const store = kv(context.env);
  if (!store) return json({ error: 'kv_unbound', message: 'KV が未設定です。' }, 500);

  const gate = await requireAuthorOrOwner(context);
  if (gate.deny) return gate.deny;
  if (!gate.isOwner) {
    return json({ error: 'forbidden', message: '審査待ちの一覧はオーナーだけが見られます。' }, 403);
  }

  return json({ ok: true, queue: await readReviewQueue(store) });
}
