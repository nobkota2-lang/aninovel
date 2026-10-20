/**
 * 作品の英語の題名・作者名  /api/admin/catalog-meta
 * ============================================================
 * 2026-10-20 追加。
 *
 * なぜ要るのか
 *   カタログの行には titleEn / authorEn / descriptionEn という欄があり、
 *   ポータルの一覧・OGP・ビューワの英題がこれを読んでいる。
 *   ところが、この欄を書き込む経路がアプリのどこにも無かった。
 *   そのため間違いが入ったまま直せない状態だった。
 *     ・『綺堂むかし語り』と『愛と美について』の authorEn が "Oonaa"
 *       （公開時に作者欄へ「オーナー」が入っていたものをローマ字化した結果）
 *     ・英題の末尾に句点が付いている
 *       "Words of the stage." / "Good old talk." / "About love and beauty."
 *
 * 何をするか
 *   GET  ?id=pub_xxx  … その作品の英語の欄を返す
 *   POST { id, titleEn, authorEn, descriptionEn }
 *                     … その3つだけを行に重ねる
 *
 *   本文には触らない。原文 (title / author) にも触らない。
 *   行は重ねるだけで、ほかの欄 (表紙・sourceLang・公開停止の印) は残す。
 *
 * 誰が使えるか
 *   オーナーだけ。作品の見え方を決める欄なので、作者には開けない。
 *
 * Cloudflare Access が "api/admin/*" を守っているので、
 * ここに来られるのは Access を通った人だけ。そのうえで roles も見る。
 */

import { kvOf } from '../../_authlib.js';
import { whoAmI, hasRole } from '../../_owner.js';

const CATALOG_KEY = '__catalog__';
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

// 直せるのはこの3つだけ。原文の欄をここから触れないようにしておく。
const FIELDS = ['titleEn', 'authorEn', 'descriptionEn'];
const MAX = { titleEn: 200, authorEn: 120, descriptionEn: 2000 };

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
    return { deny: json({ error: 'forbidden', message: '英語の題名を直せるのはオーナーだけです。' }, 403) };
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

  const url = new URL(context.request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  const catalog = await readCatalog(store);

  // id が無いときは一覧を返す。どこが空でどこが間違っているか、
  // 一度に見られた方が直しやすい。
  if (!id) {
    return json({ ok: true, works: catalog.filter(w => w && w.id).map(w => ({
      id: w.id,
      title: w.title || '',
      author: w.author || '',
      titleEn: w.titleEn || '',
      authorEn: w.authorEn || '',
      descriptionEn: w.descriptionEn || '',
    })) });
  }

  if (!ID_RE.test(id)) return json({ error: 'bad_id', message: '作品IDの形が違います。' }, 400);
  const w = catalog.find(x => x && x.id === id);
  if (!w) return json({ error: 'not_found', message: 'その作品はカタログにありません。' }, 404);
  return json({ ok: true, work: {
    id: w.id, title: w.title || '', author: w.author || '',
    titleEn: w.titleEn || '', authorEn: w.authorEn || '',
    descriptionEn: w.descriptionEn || '',
  } });
}

export async function onRequestPost(context) {
  const store = kvOf(context.env);
  if (!store) return json({ error: 'kv_unbound', message: 'KV が未設定です。' }, 500);
  const gate = await requireOwnerHere(context);
  if (gate.deny) return gate.deny;

  let body = {};
  try { body = await context.request.json(); } catch (e) { body = {}; }
  const id = String((body && body.id) || '').trim();
  if (!ID_RE.test(id)) return json({ error: 'bad_id', message: '作品IDの形が違います。' }, 400);

  const catalog = await readCatalog(store);
  const idx = catalog.findIndex(x => x && x.id === id);
  if (idx < 0) return json({ error: 'not_found', message: 'その作品はカタログにありません。' }, 404);

  const changes = {};
  for (const f of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, f)) continue;   // 送られていない欄は触らない
    let v = body[f];
    if (v === null) { changes[f] = null; continue; }                // null で欄を空にする
    v = String(v).replace(/\s+/g, ' ').trim();
    if (v.length > MAX[f]) {
      return json({ error: 'too_long', message: f + ' は ' + MAX[f] + ' 文字までです。' }, 400);
    }
    // 英語の欄に日本語が入るのは、たいてい入れ間違い。先に止める。
    if (v && /[぀-ヿ一-龯]/.test(v)) {
      return json({ error: 'not_english',
        message: f + ' に日本語が入っています。英語の欄なので、英語で入れてください。' }, 400);
    }
    changes[f] = v;
  }
  if (!Object.keys(changes).length) {
    return json({ error: 'nothing_to_do', message: '直す欄がありません。' }, 400);
  }

  // 行は重ねるだけ。本文も原文の欄も、表紙も sourceLang も触らない。
  const prev = catalog[idx];
  const next = Object.assign({}, prev);
  for (const f of Object.keys(changes)) {
    if (changes[f] === null || changes[f] === '') delete next[f];
    else next[f] = changes[f];
  }
  next.updatedAt = new Date().toISOString();
  catalog[idx] = next;
  await store.put(CATALOG_KEY, JSON.stringify(catalog));

  return json({ ok: true, id,
    before: { titleEn: prev.titleEn || '', authorEn: prev.authorEn || '',
              descriptionEn: prev.descriptionEn || '' },
    after:  { titleEn: next.titleEn || '', authorEn: next.authorEn || '',
              descriptionEn: next.descriptionEn || '' },
    message: '英語の欄を直しました。一覧とOGPにも反映されます。' });
}
