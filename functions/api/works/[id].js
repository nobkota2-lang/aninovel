/**
 * アニノベル 投稿作品API  /api/works/:id  (バージョン管理対応版)
 * --------------------------------------------------
 * 投稿(pub_*)作品をサーバー側(Cloudflare KV)に保存・取得・削除する。
 * バージョン履歴を最大20件まで保持。
 *
 * 配置: functions/api/works/[id].js
 *
 * 必要なバインディング:
 *   KV namespace を変数名 "WORKS" でバインド (wrangler.toml と一致)
 *
 * エンドポイント:
 *   GET    /api/works/pub_xxxxx              … 作品JSON取得
 *   GET    /api/works/pub_xxxxx?versions=1   … バージョン履歴一覧取得
 *   GET    /api/works/pub_xxxxx?version=3    … 特定バージョン取得
 *   PUT    /api/works/pub_xxxxx              … 保存(新バージョン作成)
 *     PUTボディ: { "data": <作品>, "meta": <カタログ> }
 *   DELETE /api/works/pub_xxxxx              … 削除
 */

import { sameSite, denyHotlink } from '../../_origin.js';
import { currentUser } from '../../_authlib.js';
import { db } from '../../_d1.js';

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const MAX_BYTES = 10 * 1024 * 1024;
const CATALOG_KEY = '__catalog__';
const MAX_VERSIONS = 20;  // 保持するバージョン履歴の最大数

// バインディング名を両対応 (WORKS 優先、なければ WORKS_KV)
function getKV(env) {
  return env.WORKS || env.WORKS_KV || null;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function readCatalog(kv) {
  try {
    const cur = await kv.get(CATALOG_KEY);
    if (!cur) return [];
    const arr = JSON.parse(cur);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// バージョン履歴を読む
/** 版の履歴を見てよい人か。よければ null、だめなら断りの応答を返す。 */
async function maySeeVersions(context, kv, id) {
  let u = null;
  try { u = await currentUser(context.request, context.env); } catch (e) { u = null; }
  if (!u) return json({ error: 'unauthorized', message: '版の履歴を見るにはログインが必要です。' }, 401);
  const roles = u.roles || [];
  if (roles.indexOf('owner') !== -1) return null;
  let ownerEmail = null;
  try {
    const cur = await kv.get('work:' + id);
    if (cur) {
      const pj = JSON.parse(cur);
      if (pj && pj.ownerEmail) ownerEmail = String(pj.ownerEmail).toLowerCase();
    }
  } catch (e) {}
  if (ownerEmail && ownerEmail === String(u.email || '').toLowerCase()) return null;
  return json({ error: 'forbidden', message: 'この作品の版の履歴は作者とオーナーだけが見られます。' }, 403);
}

async function readVersionList(kv, id) {
  try {
    const cur = await kv.get('versions:' + id);
    if (!cur) return [];
    const arr = JSON.parse(cur);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/* ------------------------------------------------------------------
 * 作品の中身からメールアドレスを外す
 * ------------------------------------------------------------------
 * 2026-10-20 追加。
 *
 * この口はログインの要らない読み取り口で、保存されている JSON を
 * そのまま返していた。その JSON には ownerEmail が入っているものが
 * あり、作者のメールアドレスが誰にでも読める状態だった。
 * （mystery-garden と pub_owner_bizwoman で実際に出ていた。）
 *
 * 作品の中身に、人の連絡先が混ざっていてよい理由はない。
 * 末尾が Email / email の鍵は、上の階層から取り除いて返す。
 *
 * 速さについて
 *   作品は 10MB まで許している。読むたびに読み直して組み直すのは
 *   重いので、まず文字として「Email"」があるかだけ見る。無ければ
 *   そのまま返す。いまの作品は、ほとんどがこの道を通る。
 *
 *   あるときだけ読み直して、上の階層の鍵を落として組み直す。
 *   読み直せないときは文字として切るが、その場合も必ず JSON として
 *   読めることを確かめてから返す。確かめられないときは返さない。
 *   漏らすより、返さない方がよい。
 *
 *   なお、本当の直し方は「作品の中身に ownerEmail を書かない」こと。
 *   持ち主は D1 の works_meta と KV の別の鍵が持っている。
 *   書き込み側（api/author/works/[id].js と api/drafts/[id]/submit.js）
 *   から外すのが次の仕事。ここはそれまでの蓋。
 */
const EMAIL_KEY_RE = /email$/i;

function looksLikeEmailKey(blob) {
  return blob.indexOf('Email"') >= 0 || blob.indexOf('email"') >= 0;
}

/** 文字のまま、"…email": "…" の一組を消す。鍵の位置を問わない。 */
function cutEmailPairs(blob) {
  return blob.replace(/\s*"[A-Za-z0-9_]*[Ee]mail"\s*:\s*(?:"(?:[^"\\]|\\.)*"|null)\s*,?/g, function (m) {
    // 後ろに , が無い（最後の鍵だった）場合は、前の , を落とす必要がある。
    return /,\s*$/.test(m) ? '' : '\u0000CUT\u0000';
  }).replace(/,\s*\u0000CUT\u0000/g, '').replace(/\u0000CUT\u0000/g, '');
}

/**
 * 返す中身と、持ち主のメール（サーバーの中だけで使う）を作る。
 * 失敗したときは null を返す。呼ぶ側は 500 を返すこと。
 */
function sanitizeWork(blob) {
  if (!looksLikeEmailKey(blob)) return { body: blob, ownerEmail: null };

  // 読み直せるなら、鍵を落として組み直す。これがいちばん確かな道。
  try {
    const obj = JSON.parse(blob);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      let owner = null;
      for (const k of Object.keys(obj)) {
        if (EMAIL_KEY_RE.test(k)) {
          if (k === 'ownerEmail' && typeof obj[k] === 'string') owner = obj[k];
          delete obj[k];
        }
      }
      return { body: JSON.stringify(obj), ownerEmail: owner };
    }
  } catch (e) { /* 下の道へ */ }

  // 読み直せなかったとき（形が想定と違う）の最後の手。
  // 文字として切ったあと、必ず JSON として読めることを確かめる。
  // 確かめずに返すと、本文の中に同じ形の文字列があった場合に
  // 壊れたものを渡してしまう。
  try {
    const cut = cutEmailPairs(blob);
    if (looksLikeEmailKey(cut)) return null;   // 取り切れていない
    JSON.parse(cut);                           // 大きさによらず必ず確かめる
    const m = blob.match(/"ownerEmail"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return { body: cut, ownerEmail: m ? m[1] : null };
  } catch (e) { return null; }
}

/**
 * 「これはあなたの作品ですか」に、はい・いいえだけで答える。
 * メールアドレスは返さない。判断はサーバーの中で済ませる。
 * ログインしていない人には答えない（null）。
 */
async function amIOwner(context, id, ownerFromBlob) {
  let u = null;
  try { u = await currentUser(context.request, context.env); } catch (e) { u = null; }
  if (!u) return null;
  const me = String(u.email || '').toLowerCase();
  if (!me) return null;

  const roles = u.roles || [];
  if (roles.indexOf('owner') !== -1) return true;

  // 持ち主の正は D1 の works_meta。作品の中身に入っている ownerEmail は、
  // 古い作品にしか無いので当てにしない。
  try {
    const d = db(context.env);
    if (d) {
      const row = await d.prepare('SELECT owner_email FROM works_meta WHERE work_id = ?1')
        .bind(id).first();
      if (row && row.owner_email) {
        return String(row.owner_email).toLowerCase() === me;
      }
    }
  } catch (e) { /* D1 が無い・引けないときは下へ */ }

  if (ownerFromBlob) return String(ownerFromBlob).toLowerCase() === me;
  return false;
}

// GET /api/works/:id
export async function onRequestGet(context) {
  // 他所のページから当サイトの本文を読ませる形の複製を断る。
  if (!sameSite(context.request)) return denyHotlink('この作品');

  const id = context.params.id;
  if (!id || !ID_RE.test(id)) {
    return json({ error: 'invalid work id: ' + String(id) + ' (allowed: starts with a letter, then [A-Za-z0-9_-], max 100 chars)' }, 400);
  }
  const kv = getKV(context.env);
  if (!kv) {
    return json({ error: 'KV namespace ("WORKS") が未バインドです' }, 500);
  }

  const url = new URL(context.request.url);

  // 版の履歴は、その作品の作者とオーナーだけが見られる。
  // 以前は誰でも取れたため、下書きや削った文章まで外から読めていた。
  if (url.searchParams.get('versions') || url.searchParams.get('version')) {
    const gate = await maySeeVersions(context, kv, id);
    if (gate) return gate;
  }

  // ?versions=1 → バージョン履歴一覧
  if (url.searchParams.get('versions')) {
    const list = await readVersionList(kv, id);
    // データ本体は含めず、メタ情報のみ返す（軽量化）
    const summary = list.map(function (v) {
      return { version: v.version, savedAt: v.savedAt, note: v.note || '' };
    });
    return json({ id: id, versions: summary });
  }

  // ?version=N → 特定バージョンを取得
  const vParam = url.searchParams.get('version');
  if (vParam) {
    const vNum = parseInt(vParam, 10);
    const list = await readVersionList(kv, id);
    const found = list.find(function (v) { return v.version === vNum; });
    if (!found) {
      return json({ error: 'version not found' }, 404);
    }
    return json({ id: id, version: vNum, data: found.data, savedAt: found.savedAt });
  }

  // 通常: 最新版を取得
  const stored = await kv.get('work:' + id);
  if (stored === null) {
    return json({ error: 'not found' }, 404);
  }

  const safe = sanitizeWork(stored);
  if (!safe) {
    // 連絡先を外せなかった。中身を返すより、返さない方を選ぶ。
    console.error('[works] ' + id + ': メールアドレスを外せませんでした');
    return json({ error: 'sanitize_failed', message: 'この作品を安全に返せませんでした。' }, 500);
  }

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // 作者判定に使う。以前は作品の中の ownerEmail を画面側で見比べて
    // いたため、メールアドレスを配る必要があった。ここでは答えだけ渡す。
    'Vary': 'Cookie',
  };
  const mine = await amIOwner(context, id, safe.ownerEmail);
  if (mine !== null) headers['X-Work-Is-Mine'] = mine ? '1' : '0';

  return new Response(safe.body, { status: 200, headers });
}

// PUT /api/works/:id — 保存 + バージョン履歴作成
// 書き込み (PUT / DELETE) は /api/author/works/:id へ移した。
// ここは読み取り専用。読者はログインなしで作品を開ける。
// 古いクライアントが PUT してきたら、新しい宛先を案内する。
export async function onRequestPut(context) {
  return json({
    error: 'moved',
    message: '保存先が /api/author/works/:id に変わりました。画面を再読込してください。'
  }, 308);
}

export async function onRequestDelete(context) {
  return json({
    error: 'moved',
    message: '削除先が /api/author/works/:id に変わりました。'
  }, 308);
}

