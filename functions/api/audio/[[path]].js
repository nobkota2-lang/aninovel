/**
 * アニノベル 音声API  /api/audio/...
 * --------------------------------------------------
 * VOICEVOX で生成した音声をサーバー(Cloudflare R2)に保存し、
 * VOICEVOX が起動していない端末を含む全クライアントへ配信する。
 *
 * 配置: functions/api/audio/[[path]].js   (リポジトリ直下の functions/ 内)
 *
 * 必要なバインディング:
 *   R2 bucket を変数名 "AUDIO_R2" でこの Pages プロジェクトにバインドする。
 *   ダッシュボード: Pages > Settings > Functions > R2 bucket bindings
 *     Variable name: AUDIO_R2  /  R2 bucket: aninovel-audio
 *
 * エンドポイント:
 *   GET /api/audio/{pubId}                  … 音声マニフェスト
 *                                             {workId, items:{...}, itemsEn:{...}}
 *   GET /api/audio/{pubId}/{itemId}         … 日本語の音声ファイル(audio/wav)
 *   GET /api/audio/{pubId}/{lang}/{itemId}  … その言語の音声ファイル
 *   PUT /api/audio/{pubId}                  … 音声の一括アップロード
 *                                             (multipart/form-data)
 *                                             フィールド名 = itemId        … 日本語
 *                                             フィールド名 = en:itemId     … 英語
 *
 * 言語ごとの置き場 (2026-10-26 追加):
 *   日本語 … pubId/itemId        これまでと同じ。既存の音声を動かさないため。
 *   英語   … pubId/en/itemId
 *   以前は言語の区別が無く、英語を送ると同じ itemId の日本語を
 *   上書きする状態だった。鍵に言語を入れて分ける。
 *
 * 注: CORS / レート制限 は functions/_middleware.js が処理する。
 */

// 作品ID。viewer 側の上書き公開が使う _OWNER_ID_RE と同じ形式を受け入れる。
//   pub_1784818723945 … 投稿作品
//   summer-adventure  … 同梱作品(スラッグ形式・ハイフンを含む)
// R2のキーは pubId + '/' + [lang + '/'] + itemId なので、'/' を含まないことだけが要件。
import { requireWrite } from '../../_auth.js';
import { signWork, verifyWork, SIGN_TTL_MS } from '../../_sign.js';

const ID_RE = /^(?:pub_[A-Za-z0-9_]{1,80}|[A-Za-z][A-Za-z0-9_-]{0,99})$/;
const ITEM_RE = /^[A-Za-z0-9_\-]{1,120}$/;

// 1リクエストあたりの一括アップロード上限 (クライアントは25件ずつ送る)
const MAX_BUNDLE = 30 * 1024 * 1024;

// 受け付ける言語。日本語だけ鍵に言語を入れない (既存データをそのまま使うため)。
const LANGS = ['ja', 'en'];

function audioKey(pubId, lang, itemId) {
  return (lang && lang !== 'ja')
    ? pubId + '/' + lang + '/' + itemId
    : pubId + '/' + itemId;
}

// R2の鍵から「言語とitemId」に戻す。pubId/ を外した残りを見る。
// 残りに '/' があれば先頭が言語。itemId に '/' は入らない(ITEM_RE)。
function parseKey(pubId, key) {
  const rest = key.slice(pubId.length + 1);
  if (!rest) return null;
  const i = rest.indexOf('/');
  if (i < 0) return { lang: 'ja', itemId: rest };
  const lang = rest.slice(0, i);
  const itemId = rest.slice(i + 1);
  if (!LANGS.includes(lang) || !itemId || itemId.indexOf('/') >= 0) return null;
  return { lang: lang, itemId: itemId };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// 自サイトからの再生か確認する (ホットリンク防止)
// --------------------------------------------------
// 海賊サイトが自分のページから当サイトの音声URLを直接読み込むと、
// ブラウザは Referer に相手のドメインを載せて送ってくる。そこで弾く。
// 相手が自前で再ホストするなら 2GB の保管と転送を自分で負担することになり、
// 丸ごと複製する旨みが薄れる。
//
// Referer が「無い」場合は通す。プライバシー設定で送らない読者が実在するため、
// ここで拒否すると正規の読者が音を聞けなくなる。
// つまり Referer を消せる相手は素通りできる。完全な封鎖ではなく、
// 「他所のページに貼るだけ」を止めるための措置。
const ALLOWED_REFERER = [
  'aninovel.com',
  'www.aninovel.com',
  'aninovel.pages.dev',
  'localhost',
  '127.0.0.1',
];

function refererAllowed(request) {
  const ref = request.headers.get('Referer') || request.headers.get('Origin') || '';
  if (!ref) return true;                       // 送ってこない読者は通す
  let host;
  try { host = new URL(ref).hostname.toLowerCase(); } catch (e) { return true; }
  return ALLOWED_REFERER.some(function (a) { return host === a || host.endsWith('.' + a); });
}

// GET — マニフェスト / 音声ファイル
export async function onRequestGet(context) {
  if (!refererAllowed(context.request)) {
    return json({
      error: 'hotlink_denied',
      message: 'この音声は aninovel.com でのみ再生できます。'
    }, 403);
  }
  const parts = context.params.path || [];
  const bucket = context.env.AUDIO_R2;
  if (!bucket) return json({ error: 'R2 bucket "AUDIO_R2" が未バインドです' }, 500);

  const pubId = parts[0];
  if (!pubId || !ID_RE.test(pubId)) return json({ error: 'invalid work id' }, 400);

  // GET /api/audio/{pubId} — 音声マニフェスト
  if (parts.length === 1) {
    const items = {};
    const itemsEn = {};
    let cursor;
    do {
      // customMetadata を含めて一覧する。ここにハッシュ(本文+話者)が入っている。
      // これが無いと「既にサーバにある」としか判定できず、
      // 中身を作り直しても itemId が同じなら送られない(実際に2度この事故が起きた)。
      const listed = await bucket.list({
        prefix: pubId + '/', cursor: cursor, limit: 1000,
        include: ['customMetadata'],
      });
      for (const obj of listed.objects) {
        const p = parseKey(pubId, obj.key);
        if (!p) continue;
        const h = obj.customMetadata && obj.customMetadata.hash;
        const entry = h ? { hash: h } : {};
        if (p.lang === 'en') itemsEn[p.itemId] = entry;
        else items[p.itemId] = entry;
      }
      cursor = listed.truncated ? listed.cursor : null;
    } while (cursor);
    // 署名を同梱する。ビューアはこれを音声URLに付けて取りに来る。
    // 取得のための往復を増やさないよう、マニフェストに載せる。
    const sign = await signWork(context.env, pubId, SIGN_TTL_MS);
    // items は従来どおり日本語。古いビューアは itemsEn を見ないので影響しない。
    return json({ workId: pubId, items: items, itemsEn: itemsEn, sign: sign, ttl: SIGN_TTL_MS });
  }

  // GET /api/audio/{pubId}?sign=1 — 署名だけ取り直す(期限切れ前の更新用)
  // ※ parts.length === 1 の分岐より前に置くと一覧が取れなくなるため、ここには来ない。

  // GET /api/audio/{pubId}/{itemId}        — 日本語の音声ファイル
  // GET /api/audio/{pubId}/{lang}/{itemId}  — その言語の音声ファイル
  if (parts.length === 2 || parts.length === 3) {
    const lang = (parts.length === 3) ? parts[1] : 'ja';
    const itemId = (parts.length === 3) ? parts[2] : parts[1];
    if (!LANGS.includes(lang)) return json({ error: 'invalid lang' }, 400);
    if (!ITEM_RE.test(itemId)) return json({ error: 'invalid item id' }, 400);
    // 期限付きの署名を確かめる。AUDIO_SIGN_KEY 未設定なら素通し(従来どおり)。
    const u = new URL(context.request.url);
    const ok = await verifyWork(context.env, pubId, u.searchParams.get('e'), u.searchParams.get('s'));
    if (!ok) {
      return json({
        error: 'signature_invalid',
        message: 'この音声URLは期限切れです。ページを開き直してください。',
      }, 403);
    }
    const obj = await bucket.get(audioKey(pubId, lang, itemId));
    if (!obj) return json({ error: 'not found' }, 404);
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'audio/wav',
        // 署名の寿命より長く持たせない(期限切れURLが中継され続けないように)
        'Cache-Control': 'private, max-age=900',
      },
    });
  }

  return json({ error: 'bad path' }, 400);
}

// PUT /api/audio/{pubId} — 音声を一括アップロード
export async function onRequestPut(context) {
  const denied = await requireWrite(context);   // 音声の上書きも作者・オーナーのみ
  if (denied) return denied;
  const parts = context.params.path || [];
  const bucket = context.env.AUDIO_R2;
  if (!bucket) return json({ error: 'R2 bucket "AUDIO_R2" が未バインドです' }, 500);

  const pubId = parts[0];
  if (!pubId || !ID_RE.test(pubId) || parts.length !== 1) {
    return json({ error: 'PUT は /api/audio/{pubId} 宛に multipart/form-data で送信してください' }, 400);
  }

  const cl = Number(context.request.headers.get('content-length') || 0);
  if (cl > MAX_BUNDLE) {
    return json({ error: '音声データが大きすぎます (1回あたり上限30MB)' }, 413);
  }

  let form;
  try {
    form = await context.request.formData();
  } catch (e) {
    return json({ error: 'multipart/form-data として読み取れませんでした' }, 400);
  }

  // 送信側は "h:<項目名>" という名前でハッシュを一緒に送る。
  // 音声そのものと同じ束に入れておけば、1往復で済む。
  // 項目名は言語の接頭辞を含んだまま使う ("h:en:xxx" なら "en:xxx")。
  const hashes = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string' && k.indexOf('h:') === 0) hashes[k.slice(2)] = v.slice(0, 64);
  }

  // 項目名から言語と itemId を取り出す。
  //   "xxx"     … 日本語 (従来どおり)
  //   "en:xxx"  … 英語
  function parseField(name) {
    const m = /^([a-z]{2}):(.+)$/.exec(name);
    if (!m) return { lang: 'ja', itemId: name };
    if (!LANGS.includes(m[1])) return null;
    return { lang: m[1], itemId: m[2] };
  }

  let saved = 0;
  const savedEn = [];
  const errors = [];
  for (const [field, file] of form.entries()) {
    // ハッシュの項目は ITEM_RE に合わないので、ID検証より先に飛ばす。
    // 順序を逆にすると「不正なID」として弾かれ、ハッシュが記録されない。
    if (field.indexOf('h:') === 0) continue;
    const p = parseField(field);
    if (!p) { errors.push(field + ': 不明な言語'); continue; }
    if (!ITEM_RE.test(p.itemId)) { errors.push(field + ': 不正なID'); continue; }
    if (typeof file === 'string' || !file.arrayBuffer) { errors.push(field + ': ファイルではありません'); continue; }
    try {
      const buf = await file.arrayBuffer();
      const put = {
        httpMetadata: { contentType: file.type || 'audio/wav' },
      };
      if (hashes[field]) put.customMetadata = { hash: hashes[field] };
      await bucket.put(audioKey(pubId, p.lang, p.itemId), buf, put);
      saved++;
      if (p.lang === 'en') savedEn.push(p.itemId);
    } catch (e) {
      errors.push(field + ': ' + e.message);
    }
  }

  return json({ ok: true, saved: saved, savedEn: savedEn.length, errors: errors });
}

// DELETE /api/audio/{pubId} — 宛先の無くなった音声を消す
// --------------------------------------------------
// 作品を取り込み直すとブロックの itemId が変わる。前の itemId で保存された
// 音声はどのブロックからも参照されないまま R2 に残り、容量だけを食う。
// それを掃除するためだけの入口で、普段の読み書きでは使わない。
//
// 消せるのは「項目名を1件ずつ明示したものだけ」。
// 前方一致・言語まるごと・作品まるごとの削除は受け付けない。
// 消す操作に「ついでに全部」を作らないのは、取り違えたときに
// 取り返しがつかないため。何を消すかは必ず呼ぶ側が列挙する。
//
// 送り方:
//   DELETE /api/audio/{pubId}
//   Content-Type: application/json
//   {"items":[{"lang":"en","itemId":"b12"},{"lang":"ja","itemId":"b13"}]}
//   言語が揃っているなら、まとめた形でもよい:
//   {"lang":"en","itemIds":["b12","b13"]}
//
// 返り値は1件ずつの結果。呼ぶ側はこれを読み返して確認する。
//   deleted  … 消した
//   missing  … 元から無かった(すでに消えている)
//   errors   … 消そうとして失敗した
const MAX_DELETE = 500;

/**
 * 受け取った本文を {lang, itemId} の配列に正す。
 * 不正な項目は捨てずに理由を返す。黙って減らすと、
 * 呼ぶ側は「消えた」と「無視された」を区別できない。
 */
export function parseDeleteBody(body) {
  const rejected = [];
  const out = [];
  const seen = Object.create(null);

  function take(lang, itemId, label) {
    const l = (lang == null || lang === '') ? 'ja' : String(lang);
    const id = (itemId == null) ? '' : String(itemId);
    if (!LANGS.includes(l)) { rejected.push(label + ': 不明な言語'); return; }
    if (!ITEM_RE.test(id)) { rejected.push(label + ': 不正なID'); return; }
    const k = l + '/' + id;
    if (seen[k]) return;                 // 同じものを2度数えない
    seen[k] = true;
    out.push({ lang: l, itemId: id });
  }

  if (body && Array.isArray(body.items)) {
    body.items.forEach(function (it, n) {
      if (!it || typeof it !== 'object') { rejected.push('items[' + n + ']: 形式が違います'); return; }
      take(it.lang, it.itemId, 'items[' + n + ']');
    });
  }
  if (body && Array.isArray(body.itemIds)) {
    body.itemIds.forEach(function (id, n) {
      take(body.lang, id, 'itemIds[' + n + ']');
    });
  }
  return { targets: out, rejected: rejected };
}

export async function onRequestDelete(context) {
  const denied = await requireWrite(context);   // 作者・オーナーのみ
  if (denied) return denied;

  const parts = context.params.path || [];
  const bucket = context.env.AUDIO_R2;
  if (!bucket) return json({ error: 'R2 bucket "AUDIO_R2" が未バインドです' }, 500);

  const pubId = parts[0];
  if (!pubId || !ID_RE.test(pubId) || parts.length !== 1) {
    return json({ error: 'DELETE は /api/audio/{pubId} 宛に JSON で送信してください' }, 400);
  }

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: 'JSON として読み取れませんでした' }, 400);
  }

  const parsed = parseDeleteBody(body);
  if (!parsed.targets.length) {
    return json({
      error: '消す対象が1件も指定されていません',
      message: 'items か itemIds で項目名を列挙してください。まとめて消す指定は受け付けません。',
      rejected: parsed.rejected,
    }, 400);
  }
  if (parsed.targets.length > MAX_DELETE) {
    return json({
      error: '1回に消せるのは ' + MAX_DELETE + ' 件までです',
      given: parsed.targets.length,
    }, 413);
  }

  // 消す前に、本当にそこにあるかを見る。
  // 「無かった」と「消した」を分けて返すため。
  const deleted = [];
  const missing = [];
  const errors = [];
  for (const t of parsed.targets) {
    const key = audioKey(pubId, t.lang, t.itemId);
    try {
      const head = await bucket.head(key);
      if (!head) { missing.push(t.lang + ':' + t.itemId); continue; }
      await bucket.delete(key);
      // 消えたことを確かめる。消したつもりで残っているのが最も困る。
      const again = await bucket.head(key);
      if (again) { errors.push(t.lang + ':' + t.itemId + ': 消えていません'); continue; }
      deleted.push(t.lang + ':' + t.itemId);
    } catch (e) {
      errors.push(t.lang + ':' + t.itemId + ': ' + (e && e.message ? e.message : String(e)));
    }
  }

  return json({
    ok: errors.length === 0,
    workId: pubId,
    指定: parsed.targets.length,
    消した: deleted.length,
    元から無かった: missing.length,
    失敗: errors.length,
    deleted: deleted,
    missing: missing,
    errors: errors,
    rejected: parsed.rejected,
  });
}
