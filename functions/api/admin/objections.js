/**
 * 差し止め請求と自動公開の記録（運営者用）  /api/admin/objections
 * ============================================================
 *   GET                      … 請求の多い作品の一覧＋自動公開の記録
 *   GET ?work=<作品ID>        … その作品に届いた請求の中身
 *   POST { workId, handled }  … 「確認した」の印を付ける／外す
 *   POST { autoLogId }        … 自動公開の記録に「確認した」の印を付ける
 *
 * Cloudflare Access が "api/admin/*" を守っているので、
 * ここに来られるのは Access を通った人だけ。そのうえで roles も見る。
 *
 * 請求が何件あっても、この窓口では作品を止めない。
 * 止めるのは /api/admin/published（公開の中止）で、理由を書いて行う。
 * 件数だけで自動的に止める作りにすると、嫌がらせで他人の作品を落とせてしまう。
 */

import { kvOf } from '../../_authlib.js';
import { whoAmI, hasRole } from '../../_owner.js';
import { readAutoLog, markAutoLogChecked } from '../../_drafts.js';
import { REASONS, readIdx, readAll, idxKey, ALL_KEY } from '../objections.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function requireOwnerHere(context) {
  let who = null;
  try { who = await whoAmI(context.request, context.env); } catch (e) { who = null; }
  if (!who) return { deny: json({ error: 'unauthorized', message: 'ログインが必要です。' }, 401) };
  if (!hasRole(who, 'owner')) {
    return { deny: json({ error: 'forbidden', message: 'オーナーだけが見られます。' }, 403) };
  }
  return { who };
}

export async function onRequestGet(context) {
  const store = kvOf(context.env);
  if (!store) return json({ error: 'kv_unbound', message: 'KV が未設定です。' }, 500);
  const gate = await requireOwnerHere(context);
  if (gate.deny) return gate.deny;

  const url = new URL(context.request.url);
  const work = url.searchParams.get('work');

  // 1作品の中身を見る
  if (work) {
    const idx = await readIdx(store, work);
    const items = [];
    try {
      const listed = await store.list({ prefix: 'obj:' + work + ':', limit: 200 });
      for (const k of (listed.keys || [])) {
        const raw = await store.get(k.name);
        if (!raw) continue;
        try {
          const o = JSON.parse(raw);
          items.push({
            reasonId: o.reasonId,
            reasonLabel: REASONS[o.reasonId] || o.reasonId,
            comment: o.comment || '',
            reporter: o.reporter || 'guest',
            at: o.at || null,
          });
        } catch (e) {}
      }
    } catch (e) {}
    items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return json({ ok: true, workId: work, summary: idx, items });
  }

  // 一覧（請求の多い順）＋ 自動公開の記録
  const all = await readAll(store);
  const autoLog = await readAutoLog(store);
  return json({
    ok: true,
    objections: all,
    autoPublished: autoLog,
    reasons: REASONS,
  });
}

export async function onRequestPost(context) {
  const store = kvOf(context.env);
  if (!store) return json({ error: 'kv_unbound', message: 'KV が未設定です。' }, 500);
  const gate = await requireOwnerHere(context);
  if (gate.deny) return gate.deny;

  let body = {};
  try { body = await context.request.json(); } catch (e) { body = {}; }

  // 自動公開の記録に印を付ける
  if (body && body.autoLogId) {
    const hit = await markAutoLogChecked(store, String(body.autoLogId));
    return json({ ok: true, marked: hit });
  }

  const workId = String((body && body.workId) || '').trim();
  if (!workId) return json({ error: 'bad_work', message: '作品IDが指定されていません。' }, 400);
  const handled = body.handled !== false;

  const idx = await readIdx(store, workId);
  if (!idx) return json({ error: 'not_found', message: 'この作品への請求は見つかりません。' }, 404);
  idx.handled = handled;
  await store.put(idxKey(workId), JSON.stringify(idx));

  const all = await readAll(store);
  const i = all.findIndex(e => e && e.workId === workId);
  if (i >= 0) { all[i].handled = handled; await store.put(ALL_KEY, JSON.stringify(all)); }

  return json({
    ok: true, workId, handled,
    message: handled ? '確認済みにしました。' : '未確認に戻しました。',
  });
}
