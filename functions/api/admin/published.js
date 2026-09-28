/**
 * 公開中の作品の一覧と、公開の中止  /api/admin/published
 * ------------------------------------------------------------
 *   GET  … いま公開されている作品の一覧
 *   POST { id, reason } … その作品の公開を中止する（読者から見えなくする）
 *
 * なぜ審査の窓口と別にしたか
 *   /api/drafts/:id/review は「作者が依頼したものを見る」窓口で、
 *   審査待ちにあるものしか扱えない。公開したあとに問題が見つかった作品は
 *   審査待ちにいないので、そこからは触れない。
 *   また、下書きを経ずに置かれた昔の作品（pub_owner_bizwoman など）には
 *   対応する下書きが無く、作者のメールもたどれない。
 *   運営者はどの作品でも止められる必要があるので、カタログを直に扱う。
 *
 * 中止しても作品そのものは消さない。
 *   カタログと公開用の本体から外すだけで、作者の下書きは残る。
 *   直して出し直せば、また審査を経て公開できる。
 *
 * Cloudflare Access が "api/admin/*" を守っているので、
 * ここに来られるのは Access を通った人だけ。そのうえで roles も見る。
 */

import { kvOf, normEmail } from '../../_authlib.js';
import { whoAmI, hasRole } from '../../_owner.js';

const CATALOG_KEY = '__catalog__';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function requireOwnerHere(context) {
  let who = null;
  try { who = await whoAmI(context.request, context.env); } catch (e) { who = null; }
  if (!who) return { deny: json({ error: 'unauthorized', message: 'ログインが必要です。' }, 401) };
  if (!hasRole(who, 'owner')) {
    return { deny: json({ error: 'forbidden', message: '公開の中止はオーナーだけが行えます。' }, 403) };
  }
  return { who };
}

async function readCatalog(store) {
  try {
    const raw = await store.get(CATALOG_KEY);
    if (!raw) return [];
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

export async function onRequestGet(context) {
  const store = kvOf(context.env);
  if (!store) return json({ error: 'kv_unbound', message: 'KV が未設定です。' }, 500);
  const gate = await requireOwnerHere(context);
  if (gate.deny) return gate.deny;

  const catalog = await readCatalog(store);
  const works = catalog
    .filter(w => w && w.id)
    .map(w => ({
      id: w.id,
      title: w.title || '（無題）',
      author: w.author || '',
      updatedAt: w.updatedAt || null,
      createdAt: w.createdAt || null,
      // 下書き経由で公開されたものは、対応する下書きIDが決まっている
      draftId: w.id.indexOf('pub_') === 0 ? 'draft_' + w.id.slice(4) : null,
    }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  return json({ ok: true, works });
}

export async function onRequestPost(context) {
  const store = kvOf(context.env);
  if (!store) return json({ error: 'kv_unbound', message: 'KV が未設定です。' }, 500);
  const gate = await requireOwnerHere(context);
  if (gate.deny) return gate.deny;

  let body = {};
  try { body = await context.request.json(); } catch (e) { body = {}; }
  const id = String((body && body.id) || '').trim();
  const reason = String((body && body.reason) || '').trim().slice(0, 2000);

  if (!id) return json({ error: 'bad_id', message: '作品IDが指定されていません。' }, 400);
  if (!reason) {
    return json({
      error: 'reason_required',
      message: '公開を中止するときは理由を書いてください。作者に伝えるためです。',
    }, 400);
  }

  // 1) 公開用の本体とカタログから外す
  const catalog = await readCatalog(store);
  const next = catalog.filter(w => !w || w.id !== id);
  const removed = catalog.length - next.length;
  if (removed > 0) await store.put(CATALOG_KEY, JSON.stringify(next));
  await store.delete('work:' + id);

  // 2) 対応する下書きがあれば、作者に理由が届くようにする
  //    下書きは消さない。直して出し直せるようにしておく。
  let notifiedAuthor = false;
  if (id.indexOf('pub_') === 0) {
    const draftId = 'draft_' + id.slice(4);
    try {
      const holder = await store.get('draftref:' + draftId);
      if (holder) {
        const key = 'draft:' + normEmail(holder) + ':' + draftId;
        const raw = await store.get(key);
        if (raw) {
          const d = JSON.parse(raw);
          d.status = 'draft';
          d.publishedId = null;
          d.pendingChanges = false;
          d.reviewNote = '運営者が公開を中止しました。理由: ' + reason;
          d.updatedAt = new Date().toISOString();
          await store.put(key, JSON.stringify(d));
          // 作者の一覧にも反映する
          try {
            const ixKey = 'drafts:' + normEmail(holder);
            const ixRaw = await store.get(ixKey);
            const ix = ixRaw ? JSON.parse(ixRaw) : [];
            if (Array.isArray(ix)) {
              const i = ix.findIndex(e => e && e.id === draftId);
              if (i >= 0) {
                ix[i].status = 'draft';
                ix[i].publishedId = null;
                ix[i].pendingChanges = false;
                ix[i].reviewNote = d.reviewNote;
                ix[i].updatedAt = d.updatedAt;
                await store.put(ixKey, JSON.stringify(ix));
              }
            }
          } catch (e) {}
          notifiedAuthor = true;
        }
      }
    } catch (e) { /* 下書きが見つからなくても、公開の中止そのものは成立している */ }
  }

  return json({
    ok: true, id, removedFromCatalog: removed, notifiedAuthor,
    message: notifiedAuthor
      ? '公開を中止し、理由を作者の画面に表示しました。'
      : '公開を中止しました。この作品に対応する下書きが無いため、作者への通知はありません。',
  });
}
