/**
 * 下書き(未公開作品)の共通処理  functions/_drafts.js
 * ------------------------------------------------------------
 * ねらい
 *   作者が書きかけの作品を、端末ではなくサーバーに置く。
 *   ただし **公開はしない**。読めるのは次の2人だけ。
 *     ・その作品を書いた作者本人 (どの端末からでも)
 *     ・審査を依頼されたときのオーナー
 *
 *   下書きは公開カタログ (__catalog__) に一切触れない。
 *   /api/catalog は __catalog__ しか読まないので、
 *   下書きがポータルの一覧や検索に出ることはない。
 *   カタログに載るのは、オーナーが承認した瞬間だけ。
 *
 * KV のキー
 *   draft:<作者メール>:<下書きID>   … 下書きの本体
 *   drafts:<作者メール>             … その作者の下書き一覧(軽い項目だけ)
 *   __drafts_review__               … 審査待ちの一覧(オーナー用)
 *
 * 一覧を別に持つ理由
 *   KV には「前方一致で探す」list() があるが、1回の呼び出しで
 *   本体を全部読むと重い。一覧だけ別に持てば読み取り1回で済む。
 *
 * 状態 (status)
 *   draft     … 作者が書いている。作者本人とオーナーだけが読める
 *   review    … 作者が公開を依頼した。オーナーの審査待ち
 *   published … オーナーが承認して公開済み
 *   rejected  … 差し戻し。理由 (reviewNote) を付けて作者に返す
 *
 * 公開したあとの編集について
 *   公開済みの作品を作者が書き換えても、その場では読者に届かない。
 *   pendingChanges に印を付けるだけで、読者が読むのは承認済みの版のまま。
 *   作者がもう一度「公開を依頼」し、オーナーが承認したときに差し替わる。
 *   初回だけ審査して、あとは編集し放題では、審査の意味がないため。
 *
 *   審査中も、すでに公開されている版は下げない。誤字直しを審査に出したら
 *   作品が読めなくなる、という不便を避けるため。
 */

import { kvOf, normEmail } from './_authlib.js';
import { whoAmI, hasRole } from './_owner.js';

export const DRAFT_ID_RE = /^draft_[A-Za-z0-9_-]{1,80}$/;
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_DRAFTS_PER_AUTHOR = 200;

export const STATUS = {
  DRAFT: 'draft',
  REVIEW: 'review',
  PUBLISHED: 'published',
  REJECTED: 'rejected',
};

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function kv(env) { return kvOf(env); }

export function newDraftId() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  const r = Array.from(a).map(x => x.toString(16).padStart(2, '0')).join('');
  return 'draft_' + Date.now().toString(36) + r;
}

function draftKey(email, id) { return 'draft:' + normEmail(email) + ':' + id; }
function indexKey(email) { return 'drafts:' + normEmail(email); }
const REVIEW_KEY = '__drafts_review__';

/**
 * 「この下書きIDの持ち主は誰か」をたどるための印。
 * オーナーは作者のメールを知らないと下書きを開けない。審査待ちの一覧からは
 * 引けるが、承認や差し戻しで一覧から外れたあとは引けなくなる。
 * そこで、一度でも審査に出た下書きだけ、この印を残しておく。
 * 書くのは状態が変わったときだけなので、KV の書き込み回数はほとんど増えない。
 */
function refKey(id) { return 'draftref:' + id; }

async function putRef(store, draft) {
  try { await store.put(refKey(draft.id), normEmail(draft.ownerEmail)); } catch (e) {}
}
async function readRef(store, id) {
  try { return (await store.get(refKey(id))) || null; } catch (e) { return null; }
}

/* ---------------- 読み書き ---------------- */

export async function readDraft(store, email, id) {
  try {
    const raw = await store.get(draftKey(email, id));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return (d && typeof d === 'object') ? d : null;
  } catch (e) { return null; }
}

export async function writeDraft(store, draft) {
  draft.updatedAt = new Date().toISOString();
  await store.put(draftKey(draft.ownerEmail, draft.id), JSON.stringify(draft));
  await upsertIndex(store, draft);
  return draft;
}

export async function removeDraft(store, email, id) {
  await store.delete(draftKey(email, id));
  try { await store.delete(refKey(id)); } catch (e) {}
  const list = await readIndex(store, email);
  const next = list.filter(e => e && e.id !== id);
  if (next.length !== list.length) {
    await store.put(indexKey(email), JSON.stringify(next));
  }
  await dropFromReview(store, id);
}

/* ---------------- 一覧 ---------------- */

/** 一覧に載せる軽い項目だけを取り出す。本文(data)は含めない。 */
export function summarize(d) {
  return {
    id: d.id,
    title: d.title || '無題の作品',
    penName: d.penName || '',
    status: d.status || STATUS.DRAFT,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
    submittedAt: d.submittedAt || null,
    reviewedAt: d.reviewedAt || null,
    reviewNote: d.reviewNote || '',
    publishedId: d.publishedId || null,
    pendingChanges: !!d.pendingChanges,
    aiReview: d.aiReview ? {
      verdict: d.aiReview.verdict, level: d.aiReview.level,
      categories: d.aiReview.categories || [], reasons: d.aiReview.reasons || [],
      diff: d.aiReview.diff || null, model: d.aiReview.model || null,
      at: d.aiReview.at || null,
    } : null,
    itemCount: (d.data && Array.isArray(d.data.content)) ? d.data.content.length : 0,
  };
}

export async function readIndex(store, email) {
  try {
    const raw = await store.get(indexKey(email));
    if (!raw) return [];
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

async function upsertIndex(store, draft) {
  const list = await readIndex(store, draft.ownerEmail);
  const row = summarize(draft);
  const i = list.findIndex(e => e && e.id === draft.id);
  if (i >= 0) list[i] = row; else list.push(row);
  list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  await store.put(indexKey(draft.ownerEmail), JSON.stringify(list));
}

/* ---------------- 審査待ちの一覧 ---------------- */

export async function readReviewQueue(store) {
  try {
    const raw = await store.get(REVIEW_KEY);
    if (!raw) return [];
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

export async function putInReview(store, draft) {
  const q = await readReviewQueue(store);
  const row = Object.assign(summarize(draft), { ownerEmail: draft.ownerEmail });
  const i = q.findIndex(e => e && e.id === draft.id);
  if (i >= 0) q[i] = row; else q.push(row);
  q.sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
  await store.put(REVIEW_KEY, JSON.stringify(q));
  await putRef(store, draft);
}

/* ---------------- 自動公開の記録 ---------------- */

const AUTOLOG_KEY = '__drafts_autolog__';
const AUTOLOG_MAX = 200;

/**
 * AI の確認だけで公開した編集を、運営者があとから見直せるように残す。
 * 自動公開は「人が見ていない公開」なので、記録が無いと後で追えない。
 * 運営者は管理画面でこの一覧を見て、気になるものを開いて確かめられる。
 */
export async function logAutoPublish(store, draft, ai) {
  try {
    const raw = await store.get(AUTOLOG_KEY);
    let log = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(log)) log = [];
    log.unshift({
      id: draft.id,
      publishedId: draft.publishedId || null,
      title: draft.title || '',
      ownerEmail: draft.ownerEmail || '',
      at: new Date().toISOString(),
      diff: (ai && ai.diff) || null,
      model: (ai && ai.model) || null,
      checked: false,          // 運営者が目を通したか
    });
    if (log.length > AUTOLOG_MAX) log.length = AUTOLOG_MAX;
    await store.put(AUTOLOG_KEY, JSON.stringify(log));
  } catch (e) { /* 記録に失敗しても公開そのものは成立している */ }
}

export async function readAutoLog(store) {
  try {
    const raw = await store.get(AUTOLOG_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

/** 運営者が「確認した」と印を付ける。 */
export async function markAutoLogChecked(store, id) {
  try {
    const log = await readAutoLog(store);
    let hit = false;
    log.forEach(e => { if (e && e.id === id && !e.checked) { e.checked = true; hit = true; } });
    if (hit) await store.put(AUTOLOG_KEY, JSON.stringify(log));
    return hit;
  } catch (e) { return false; }
}

export async function dropFromReview(store, id) {
  const q = await readReviewQueue(store);
  const next = q.filter(e => e && e.id !== id);
  if (next.length !== q.length) await store.put(REVIEW_KEY, JSON.stringify(next));
}

/* ---------------- 権限 ---------------- */

/**
 * 「いま操作している人」を決めて、作者かオーナーであることを確かめる。
 * @returns {Promise<{deny?:Response, who?:object, isOwner?:boolean}>}
 */
export async function requireAuthorOrOwner(context) {
  let who = null;
  try { who = await whoAmI(context.request, context.env); } catch (e) { who = null; }
  if (!who) {
    return { deny: json({ error: 'unauthorized', message: 'ログインが必要です。' }, 401) };
  }
  const owner = hasRole(who, 'owner');
  if (!hasRole(who, 'author') && !owner) {
    return { deny: json({ error: 'forbidden', message: '作者かオーナーのアカウントが必要です。' }, 403) };
  }
  return { who, isOwner: owner };
}

/**
 * 下書き1件を、読んでよい人にだけ渡す。
 * 作者本人は常に読める。オーナーは「審査を依頼された(review 以降)」ものだけ。
 * 書いている最中の draft を、依頼もされていないのにオーナーが覗くことはしない。
 */
export async function loadForReader(context, id, opts) {
  const need = opts || {};
  const store = kv(context.env);
  if (!store) return { deny: json({ error: 'kv_unbound', message: 'KV が未設定です。' }, 500) };
  if (!DRAFT_ID_RE.test(String(id || ''))) {
    return { deny: json({ error: 'bad_id', message: '下書きIDの形式が違います。' }, 400) };
  }

  const gate = await requireAuthorOrOwner(context);
  if (gate.deny) return gate;

  // まず本人の棚を見る
  let draft = await readDraft(store, gate.who.email, id);
  if (draft) return { store, who: gate.who, isOwner: gate.isOwner, draft, mine: true };

  // 本人の棚に無い。オーナーなら、審査待ちの一覧か、残した印から持ち主を引く。
  // 印をたどるのは、承認・差し戻しで一覧から外れたあとも開けるようにするため。
  if (gate.isOwner) {
    const q = await readReviewQueue(store);
    const row = q.find(e => e && e.id === id);
    const holder = (row && row.ownerEmail) || await readRef(store, id);
    if (holder) {
      const d = await readDraft(store, holder, id);
      if (d) {
        if (need.mineOnly) {
          return { deny: json({ error: 'forbidden', message: '他の作者の下書きは編集できません。' }, 403) };
        }
        return { store, who: gate.who, isOwner: true, draft: d, mine: false };
      }
    }
  }
  return { deny: json({ error: 'not_found', message: '下書きが見つかりません。' }, 404) };
}

/* ---------------- 公開(承認されたときだけ) ---------------- */

const CATALOG_KEY = '__catalog__';

async function readCatalog(store) {
  try {
    const raw = await store.get(CATALOG_KEY);
    if (!raw) return [];
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

/** 下書きから、公開カタログに載せる1行を組み立てる。 */
export function buildCatalogEntry(draft, pubId) {
  const content = (draft.data && Array.isArray(draft.data.content)) ? draft.data.content : [];
  let charCount = 0;
  content.forEach(c => { charCount += String((c && c.text) || '').length; });
  const pageCount = Math.max(1, Math.ceil(content.length / 10));
  const characters = (draft.data && Array.isArray(draft.data.characters)) ? draft.data.characters : [];
  const characterCount = characters.filter(c => c && c.id !== 'narrator').length;
  const tags = [];
  if (characterCount > 3) tags.push('群像劇');
  tags.push(charCount > 5000 ? '長編' : '短編');

  const title = (draft.data && draft.data.novel && draft.data.novel.title) || draft.title || '無題の作品';
  const author = draft.penName || (draft.data && draft.data.novel && draft.data.novel.author) || '名無しの作者';

  return {
    id: pubId,
    title,
    author,                       // 画面に出る作者名。権限(ownerEmail)とは別物。
    authorRole: 'author',
    description: draft.description || (title + ' / ' + author),
    coverColor: draft.coverColor || 'linear-gradient(135deg, #6366F1, #8B5CF6)',
    pageCount,
    charCount,
    characterCount,
    tags,
    createdAt: draft.createdAt || new Date().toISOString(),
    contentUrl: null,
  };
}

/**
 * 承認して公開する。ここが唯一「下書きがカタログに載る」場所。
 * 同じ下書きを2回目に公開したときは、前と同じ公開IDへ上書きする。
 */
export async function publishDraft(store, draft) {
  const pubId = draft.publishedId || ('pub_' + draft.id.replace(/^draft_/, ''));
  const entry = buildCatalogEntry(draft, pubId);

  // 作品の本体。ownerEmail は「誰が編集してよいか」の印で、表示名とは別。
  const data = Object.assign({}, draft.data, { ownerEmail: normEmail(draft.ownerEmail) });
  await store.put('work:' + pubId, JSON.stringify(data));

  const catalog = await readCatalog(store);
  const row = Object.assign({}, entry, { updatedAt: new Date().toISOString() });
  const i = catalog.findIndex(w => w && w.id === pubId);
  if (i >= 0) catalog[i] = row; else catalog.push(row);
  await store.put(CATALOG_KEY, JSON.stringify(catalog));

  return { pubId, entry: row, meta: {
    workId: pubId, draftId: draft.id, ownerEmail: draft.ownerEmail,
    title: entry.title, status: 'published',
    createdAt: draft.createdAt, publishedAt: row.updatedAt,
  } };
}

/** 公開を取り下げる。カタログからも本体からも消す。下書きは残す。 */
export async function unpublishWorkId(store, pubId) {
  await store.delete('work:' + pubId);
  const catalog = await readCatalog(store);
  const next = catalog.filter(w => !w || w.id !== pubId);
  const removed = catalog.length - next.length;
  if (removed > 0) await store.put(CATALOG_KEY, JSON.stringify(next));
  return removed;
}
