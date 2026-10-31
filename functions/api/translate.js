// functions/api/translate.js  v5 — 原文言語(source)対応版
// v5: source/sourceLang受理 / 日本語ターゲット対応(ローマ字化の抑止・劣化閾値の緩和) / 著者名のローマ字化
// 翻訳エンジン: Cloudflare Workers AI  @cf/meta/m2m100-1.2b
// 劣化検出強化 + llama-3.1-8b-instruct フォールバック + 名前ローマ字化（緩い検証）
// デバッグ: ?debug=1 で AI レスポンスを返す
//
// 2026-10-04 に直したこと
//
// 1) 訳せなかった行の日本語が、そのままキャッシュに焼き付いていた
//    1文ずつ訳し、失敗したら原文(日本語)を入れる作りになっている。
//    表示を止めないための措置としては正しいが、その結果を 90 日の
//    キャッシュに書いていたため、一度失敗すると以後ずっと日本語が
//    返り続けた。雪女と 10階 が壊れたのはこれが原因。
//    → 訳文に原文の文字が残っているうちは**キャッシュに書かない**。
//      返しはするので表示は止まらない。次に呼ばれたときやり直せる。
//
// 2) 大きい作品で 503 が HTML で返っていた
//    1リクエストの中で全ブロックを AI に通すので、長編では時間切れになり、
//    Cloudflare 自身のエラーページ(HTML)が返る。JSON を期待している
//    呼び出し側はパースに失敗し、何が起きたのか分からなかった。
//    → 時間の budget を持ち、超えたら**そこまでの結果を JSON で返す**。
//      partial: true を立て、キャッシュには書かない。
//
// 制限に達したときも必ず JSON を返す、というのがこの版の約束。
//
// 点検: POST {probe:true, workId:'pub_xxx'} で、その作品のキャッシュに
//       原文がどれだけ残っているかを返す。AI は使わないので何度でも呼べる。
//
// 退避: POST {dump:{part:0,size:1200}, workId:'pub_xxx'} で、入っている英訳を
//       原文と対にして返す。AI は使わない。tools/BACKUP_en.js がこれを使って
//       全作品をディスクへ退避する。復元は本文テキストで照合するので、
//       ja と en を必ず対で持つこと。

import { requireWriter } from '../_owner.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...CORS };

const LANG = { en:'english', ja:'japanese', zh:'chinese', ko:'korean', es:'spanish', fr:'french', de:'german', pt:'portuguese', it:'italian' };
const ISO  = { en:'English', ja:'Japanese', zh:'Chinese', ko:'Korean', es:'Spanish', fr:'French', de:'German', pt:'Portuguese', it:'Italian' };

const MODEL = '@cf/meta/m2m100-1.2b';
const FALLBACK_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/google/gemma-3-12b-it',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
];
let _activeFallback = null; // セッション内で生きてるモデルを記憶
const CONCURRENCY = 4;
const MAX_CHARS_PER_CHUNK = 120;

// 1リクエストで使ってよい時間。これを超えたら、そこまでの結果を返す。
// Cloudflare に殺されて HTML を返すより、途中までの JSON のほうがよい。
const TIME_BUDGET_MS = 20000;

/** その言語の文字が残っているか（訳せていない目印） */
function hasSourceScript(text, srcLangCode) {
  if (!text) return false;
  if (srcLangCode === 'ja' || srcLangCode === 'zh') return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
  if (srcLangCode === 'ko') return /[\uac00-\ud7af]/.test(text);
  return false;
}

export async function onRequestOptions() { return new Response(null, { headers: CORS }); }

export async function onRequestPost(context) {
  const { request, env } = context;
  const debug = new URL(request.url).searchParams.get('debug') === '1';
  const dbg = []; // デバッグログ
  const _startedAt = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    // ===== 大きい作品向け: 分割して保存・取得する =====
    // 猫のように 4,700 件ある作品は、全件を 1 回の POST で送ると
    // ボディが 2.8MB を超えて Cloudflare に拒まれる(即座に 503)。
    // そこで、本文を送らずに「作品IDとチャンク番号」だけで読み書きできる
    // 別経路を用意する。キーは作品IDに紐づくので、人物の増減で変わらない。
    if (body.chunk && body.workId) {
      const wid = String(body.workId).slice(0, 80);
      const part = parseInt(body.chunk.part, 10) || 0;
      const ckey = `worktr_chunk:${(body.target||'en').toLowerCase()}:${wid}:${part}`;
      const KV2 = env.WORKS || env.WORKS_KV;
      if (!KV2) return json({ error: 'no_kv' }, 500);

      // 書き込み
      if (body.chunk.write) {
        // 以前はソースに直書きの合言葉(writeKey)で通していた。
        // リポジトリが公開なので誰でも読めて、誰でも全作品の訳を
        // 上書きできる状態だった。作者かオーナーのログインを必須にする。
        const w = await requireWriter(context);
        if (w.deny) return w.deny;
        const payload = JSON.stringify({
          items: body.chunk.items || {},        // { blockId: 英訳 }
          chars: body.chunk.chars || {},        // { charId: 英名 }
          title: body.titleTr || '',
          author: body.authorTr || '',
          total: parseInt(body.chunk.total, 10) || 0,
        });
        await KV2.put(ckey, payload, { expirationTtl: 60 * 60 * 24 * 365 });
        return new Response(JSON.stringify({ ok: true, part, bytes: payload.length }),
          { headers: { ...JSON_HEADERS, 'X-Cache': 'WRITE-CHUNK' } });
      }

      // 読み出し
      const got = await KV2.get(ckey);
      if (!got) return json({ error: 'not_found', part }, 404);
      return new Response(got, { headers: { ...JSON_HEADERS, 'X-Cache': 'HIT-CHUNK' } });
    }

    // ===== 迷子探し: どの作品からも参照されていない英訳を見つける =====
    //
    // 鍵は「本文・ブロックid・人物名」から作る。だから本文を直すか、
    // 人物が増減するだけで鍵が変わり、前の英訳は KV に残ったまま
    // 誰からも参照されなくなる(孤児化)。読者には機械翻訳が出る。
    // 雪女がこれで、手訳22件が参照されない状態になっていた
    // (再取り込みで お雪・茂作 が消え、人物名が鍵に入っているため)。
    //
    // 消えてはいないので、拾い直せば訳し直す必要はない。
    // ここでは worktr7: の鍵を全部並べ、いまの各作品から計算した鍵と
    // 突き合わせて、合わないものを「迷子」として返す。
    // AI は使わない。読むだけで、KV は1バイトも書き換えない。
    if (body.orphans) {
      const w2 = await requireWriter(context);
      if (w2.deny) return w2.deny;
      const KVo = env.WORKS || env.WORKS_KV;
      if (!KVo) return json({ error: 'no_kv' }, 500);

      const oTarget = (body.target || 'en').toLowerCase();
      const TYPES2 = ['narration', 'dialogue', 'chapter_break', 'section_break'];

      // 鍵を1つ指定されたら、その中身をそのまま返す。
      // 迷子だと分かった訳を取り出して、いまの鍵へ書き戻すために使う。
      // 生きている鍵の計算をしないので軽い。
      if (body.orphans.key) {
        const ok1 = String(body.orphans.key);
        if (!/^worktr7:[a-z]{2}:[0-9a-f]{40}$/.test(ok1)) {
          return json({ error: 'bad_key', message: 'worktr7:<言語>:<40桁> の形で指定してください。' }, 400);
        }
        const g = await KVo.get(ok1);
        if (!g) return json({ error: 'not_found', key: ok1 }, 404);
        return new Response(g, { headers: { ...JSON_HEADERS, 'X-Cache': 'HIT-ORPHAN' } });
      }

      // いま生きている鍵を作る。カタログに載っている作品ぶん。
      const live = Object.create(null);
      let catalog = [];
      try {
        const c = await KVo.get('__catalog__');
        catalog = c ? JSON.parse(c) : [];
        if (!Array.isArray(catalog)) catalog = [];
      } catch (e) { catalog = []; }
      for (const row of catalog) {
        const id = row && row.id;
        if (!id) continue;
        let wk = null;
        try { const raw = await KVo.get('work:' + id); wk = raw ? JSON.parse(raw) : null; }
        catch (e) { wk = null; }
        if (!wk || !Array.isArray(wk.content)) continue;
        const li = wk.content.filter((it) => it && it.text && TYPES2.indexOf(it.type) >= 0)
                             .map((it) => [it.id, it.text]);
        const lc = (wk.characters || []).filter((c) => c && c.id !== 'narrator' && c.name)
                                        .map((c) => [c.id, c.name]);
        const ls = (wk.sourceLang || 'ja').toLowerCase();
        const lt = (wk.novel && wk.novel.title) || '';
        const canon = JSON.stringify({ v:4, t:oTarget, s:ls, title:lt, items:li, chars:lc });
        live[`worktr7:${oTarget}:${(await sha256hex(canon)).slice(0, 40)}`] =
          { id: id, title: lt, blocks: li.length };
      }

      // 鍵を並べる。1回で見きれない場合は cursor で続ける。
      const lim = Math.min(30, Math.max(1, parseInt(body.orphans.limit, 10) || 10));
      const lst = await KVo.list({ prefix: `worktr7:${oTarget}:`,
        cursor: body.orphans.cursor || undefined });

      const orphanKeys = [], liveKeys = [];
      for (const k of (lst.keys || [])) {
        if (Object.prototype.hasOwnProperty.call(live, k.name)) liveKeys.push(k.name);
        else orphanKeys.push(k.name);
      }

      // 中身を読むのは重いので、頼まれた件数だけ。題名と先頭の数件が
      // 分かれば、どの作品の訳かは人が見て判別できる。
      const detail = [];
      for (const k of orphanKeys.slice(0, lim)) {
        let v = null;
        try { const g = await KVo.get(k); v = g ? JSON.parse(g) : null; } catch (e) { v = null; }
        if (!v) { detail.push({ key: k, 読めません: true }); continue; }
        const its = Array.isArray(v.items) ? v.items : [];
        let srcLeft = 0;
        for (const it of its) if (hasSourceScript(it && it.text, (v.source || 'ja'))) srcLeft++;
        detail.push({
          key: k, title: v.title || '', author: v.author || '',
          source: v.source || '', 件数: its.length,
          人物: Array.isArray(v.characters) ? v.characters.length : 0,
          原文のまま: srcLeft,
          手訳らしさ: its.length && srcLeft === 0 ? '全件が訳されている' : '原文が残っている',
          先頭: its.slice(0, 3).map((x) => String((x && x.text) || '').slice(0, 70)),
        });
      }

      return json({
        ok: true, target: oTarget,
        カタログの作品数: catalog.length,
        生きている鍵: Object.keys(live).length,
        この頁で見た鍵: (lst.keys || []).length,
        内_生きている: liveKeys.length,
        内_迷子: orphanKeys.length,
        迷子の中身: detail,
        迷子の鍵: orphanKeys,
        続きがある: !lst.list_complete,
        cursor: lst.cursor || null,
        注意: 'これは読むだけです。KV は書き換えていません。'
            + '件数と題名でどの作品の訳か見当をつけ、/api/translate の '
            + 'providedTranslations で現在の鍵へ書き戻してください。',
      });
    }

    // ===== 点検: どの作品のキャッシュが壊れているかを調べる =====
    // AI は使わない。KV を読んで、原文の文字が残っている件数を数えるだけ。
    // 作品IDを渡すと、ビューアが送るのと同じ形の本文・人物を KV から
    // 組み立ててキーを求めるので、呼ぶ側は本文を知らなくてよい。
    if (body.probe) {
      const w0 = await requireWriter(context);
      if (w0.deny) return w0.deny;
      const KV0 = env.WORKS || env.WORKS_KV;
      if (!KV0) return json({ error: 'no_kv' }, 500);
      const wid = String(body.workId || '').slice(0, 100);
      if (!wid) return json({ error: 'bad_work', message: 'workId を指定してください。' }, 400);

      let work = null;
      try {
        const raw = await KV0.get('work:' + wid);
        work = raw ? JSON.parse(raw) : null;
      } catch (e) { work = null; }
      if (!work || !Array.isArray(work.content)) {
        return json({ error: 'not_found', workId: wid }, 404);
      }

      // ビューアの translateWork が組み立てるのと同じ形にする。
      // ここがずれると違う鍵を見ることになり、嘘の結果が出る。
      const TYPES = ['narration', 'dialogue', 'chapter_break', 'section_break'];
      const pItems = work.content
        .filter((it) => it && it.text && TYPES.indexOf(it.type) >= 0)
        .map((it) => ({ id: it.id, text: it.text }));
      const pChars = (work.characters || [])
        .filter((c) => c && c.id !== 'narrator' && c.name)
        .map((c) => ({ id: c.id, name: c.name }));
      const pTarget = (body.target || 'en').toLowerCase();
      const pSource = (work.sourceLang || body.source || 'ja').toLowerCase();
      const pTitle = (work.novel && work.novel.title) || '';

      const pCanon = JSON.stringify({ v:4, t:pTarget, s:pSource, title: pTitle,
        items: pItems.map(i => [i.id, i.text]), chars: pChars.map(c => [c.id, c.name]) });
      const pKey = `worktr7:${pTarget}:${(await sha256hex(pCanon)).slice(0, 40)}`;

      const pRead = await readStored(KV0, pTarget, wid, pKey);
      const pEnItems = pRead.items, pEnChars = pRead.chars;
      const pFrom = pRead.from === 'none' ? null : pRead.from;
      const pParts = pRead.parts;

      if (!pFrom) {
        return json({ workId: wid, title: pTitle, key: pKey, cached: false,
          blocks: pItems.length, 取り出し元: 'none',
          判定: '未翻訳', 説明: 'キャッシュがありません。まだ訳していないか、本文が変わって鍵が変わりました。' });
      }

      // 本文の側から数える。訳の側だけ見ていると「訳が1件も無いブロック」を
      // 見落とす(夏の日の冒険がその形だった)。
      let bad = 0, missing = 0; const samples = [], misses = [];
      for (const it of pItems) {
        const en = Object.prototype.hasOwnProperty.call(pEnItems, it.id) ? pEnItems[it.id] : null;
        if (en == null || en === '') {
          missing++;
          if (misses.length < 3) misses.push({ id: it.id, text: String(it.text).slice(0, 60) });
          continue;
        }
        if (hasSourceScript(en, pSource)) {
          bad++;
          if (samples.length < 3) samples.push({ id: it.id, text: String(en).slice(0, 60) });
        }
      }
      let badChars = 0;
      for (const c of pChars) {
        const en = Object.prototype.hasOwnProperty.call(pEnChars, c.id) ? pEnChars[c.id] : null;
        if (en == null || en === '' || hasSourceScript(en, pSource)) badChars++;
      }
      const ng = bad + missing;
      return json({ workId: wid, title: pTitle, key: pKey, cached: true,
        取り出し元: pFrom, 分割数: pParts, 別の置き場: pRead['別の置き場'],
        blocks: pItems.length, 訳がある: pItems.length - missing,
        原文のまま: bad, 訳が無い: missing, 人物名が未訳: badChars,
        割合: pItems.length ? Math.round(ng / pItems.length * 1000) / 10 + '%' : '0%',
        判定: ng === 0 && badChars === 0 ? '健全'
            : (ng > pItems.length * 0.1 ? '要修復' : '一部に残存'),
        例: samples, 訳が無い例: misses });
    }

    // ===== 退避: 入っている英訳を原文と対にして取り出す =====
    // AI は使わない。KV を読むだけなので何度でも呼べる。
    //
    // なぜ要るか: 手訳は「本文・ブロックid・人物名」から作る鍵の下にしか無い。
    // 本文を1文字直すだけ、取り込み直すだけで鍵が変わり、訳が孤児になる。
    // 実際に注文の多い料理店と猫でそれが起きた。先に退避してあれば
    // INJECT_bytext_loader.js で戻せる。
    //
    // 戻すときは id ではなく**原文テキスト**で照合する(取り込みのたびに
    // id も話者判別の結果も変わるため)。だからここは必ず ja と en を
    // 対にして返す。en だけ持っていても復元できない。
    if (body.dump) {
      const w1 = await requireWriter(context);
      if (w1.deny) return w1.deny;
      const KV1 = env.WORKS || env.WORKS_KV;
      if (!KV1) return json({ error: 'no_kv' }, 500);
      const wid = String(body.workId || '').slice(0, 100);
      if (!wid) return json({ error: 'bad_work', message: 'workId を指定してください。' }, 400);

      let work = null;
      try {
        const raw = await KV1.get('work:' + wid);
        work = raw ? JSON.parse(raw) : null;
      } catch (e) { work = null; }
      if (!work || !Array.isArray(work.content)) {
        return json({ error: 'not_found', workId: wid }, 404);
      }

      // probe と同じ組み立て。ここがずれると別の鍵を見て「訳が無い」と
      // 誤報する。片方だけ直すと食い違うので、両方を同時に直すこと。
      const TYPES = ['narration', 'dialogue', 'chapter_break', 'section_break'];
      const dItems = work.content
        .filter((it) => it && it.text && TYPES.indexOf(it.type) >= 0)
        .map((it) => ({ id: it.id, type: it.type, text: it.text }));
      const dChars = (work.characters || [])
        .filter((c) => c && c.id !== 'narrator' && c.name)
        .map((c) => ({ id: c.id, name: c.name }));
      const dTarget = (body.target || 'en').toLowerCase();
      const dSource = (work.sourceLang || body.source || 'ja').toLowerCase();
      const dTitle = (work.novel && work.novel.title) || '';
      const dAuthor = (work.novel && work.novel.author) || '';

      const dCanon = JSON.stringify({ v:4, t:dTarget, s:dSource, title: dTitle,
        items: dItems.map(i => [i.id, i.text]), chars: dChars.map(c => [c.id, c.name]) });
      const dKey = `worktr7:${dTarget}:${(await sha256hex(dCanon)).slice(0, 40)}`;

      const dRead = await readStored(KV1, dTarget, wid, dKey);
      const enItems = dRead.items, enChars = dRead.chars;
      const from = dRead.from === 'none' ? null : dRead.from;
      const trTitle = dRead.title, trAuthor = dRead.author, parts = dRead.parts;

      // 本文が多いと1回の応答に収まらないので、頼まれた範囲だけ返す。
      const size = Math.min(3000, Math.max(50, parseInt(body.dump.size, 10) || 1200));
      const part = Math.max(0, parseInt(body.dump.part, 10) || 0);
      const totalParts = Math.max(1, Math.ceil(dItems.length / size));
      const slice = dItems.slice(part * size, part * size + size);

      let missing = 0, stale = 0;
      const blocks = slice.map((it) => {
        const en = Object.prototype.hasOwnProperty.call(enItems, it.id) ? enItems[it.id] : null;
        if (en == null || en === '') missing++;
        else if (hasSourceScript(en, dSource)) stale++;
        return { id: it.id, type: it.type, ja: it.text, en: en };
      });

      // 人物は件数が少ないので毎回まとめて返す。復元時に要る。
      const chars = dChars.map((c) => ({
        id: c.id, ja: c.name,
        en: Object.prototype.hasOwnProperty.call(enChars, c.id) ? enChars[c.id] : null,
      }));

      return json({
        ok: true, workId: wid, key: dKey, from: from || 'none', chunkParts: parts,
        別の置き場: dRead['別の置き場'],
        target: dTarget, sourceLang: dSource,
        title: dTitle, titleTr: trTitle, author: dAuthor, authorTr: trAuthor,
        blocks: blocks, chars: chars,
        part: part, size: size, totalParts: totalParts, totalBlocks: dItems.length,
        訳が無い: missing, 原文のまま: stale,
        判定: !from ? '退避できる訳がありません'
             : (missing === 0 && stale === 0 ? '健全'
             : (missing + stale > slice.length * 0.1 ? '要修復' : '一部に欠け')),
      });
    }

    const target = (body.target || 'en').toLowerCase();
    const source = (body.source || body.sourceLang || 'ja').toLowerCase();
    const title = (body.title || '').toString();
    const author = (body.author || '').toString();
    const items = Array.isArray(body.items) ? body.items.filter(i => i && i.id && typeof i.text === 'string') : [];
    const characters = Array.isArray(body.characters) ? body.characters.filter(c => c && c.id && typeof c.name === 'string' && c.name.trim()) : [];

    if (items.length === 0 && !title && characters.length === 0) return json({ error:'no_content' }, 400);
    if (target === source) return json({ title, author, items, characters, cache:'NOOP' });

    const srcLang = LANG[source] || source;
    const tgtLang = LANG[target] || target;
    const srcISO  = ISO[source]  || source;
    const tgtISO  = ISO[target]  || target;

    // キャッシュ v4（再翻訳強制）
    const KV = env.WORKS || env.WORKS_KV;

    // ===== 現行モデルを順に試して、最初に成功したモデルで実行 =====
    async function runWithFallback(payload){
      const order = _activeFallback
        ? [_activeFallback, ...FALLBACK_MODELS.filter(m=>m!==_activeFallback)]
        : FALLBACK_MODELS.slice();
      let lastErr = null;
      for (const m of order) {
        try {
          const r = await env.AI.run(m, payload);
          _activeFallback = m;
          if (debug) dbg.push({op:'fallback-model-ok', model: m});
          return { ok: true, model: m, response: r };
        } catch (e) {
          lastErr = e;
          if (debug) dbg.push({op:'fallback-model-fail', model: m, error: String(e && e.message)});
        }
      }
      return { ok: false, error: lastErr };
    }

    const canonical = JSON.stringify({ v:4, t:target, s:source, title, items:items.map(i=>[i.id,i.text]), chars:characters.map(c=>[c.id,c.name]) });
    const hash = (await sha256hex(canonical)).slice(0, 40);
    const cacheKey = `worktr7:${target}:${hash}`;


    // ===== オーナー英訳の直接書き込み(AIを使わない・quota消費なし) =====
    if (body.providedTranslations && typeof body.providedTranslations === 'object') {
      const w = await requireWriter(context);
      if (w.deny) return w.deny;
      const pv = body.providedTranslations;
      const itemsOut = items.map(i => ({ id: i.id, text: (pv[i.id] != null ? String(pv[i.id]) : i.text) }));
      const charsOut = [];
      for (const c of characters) charsOut.push({ id:c.id, name: (pv['__char_'+c.id] != null ? String(pv['__char_'+c.id]) : c.name) });
      const wout = { target, source, title: (body.titleTr || body.titleEn || title), author: (body.authorTr || body.authorEn || author), items: itemsOut, characters: charsOut };
      const wpayload = JSON.stringify(wout);
      if (KV) await KV.put(cacheKey, wpayload, { expirationTtl: 60 * 60 * 24 * 365 }).catch(() => {});
      return new Response(wpayload, { headers: { ...JSON_HEADERS, 'X-Cache':'WRITE' } });
    }
    if (KV && !debug) {
      const cached = await KV.get(cacheKey);
      if (cached) return new Response(cached, { headers: { ...JSON_HEADERS, 'X-Cache':'HIT', 'X-KV': KV === env.WORKS ? 'WORKS' : 'WORKS_KV' } });
    }
    if (!env.AI) return json({ error:'not_configured', message:'AI binding missing' }, 500);

    // ===== 文分割 =====
    function splitSentences(text){
      if(!text) return [];
      const parts = [];
      let buf = '', last = 0, m;
      const re = /([\u3002\uFF01\uFF1F!?！？。]+["'\u201D\u2019\uFF02\uFF07）)\]］】]*\s*)|([\.]+\s+)/g;
      while ((m = re.exec(text)) !== null) {
        buf += text.slice(last, m.index) + m[0];
        parts.push(buf); buf = ''; last = re.lastIndex;
      }
      buf += text.slice(last);
      if (buf) parts.push(buf);
      const out = [];
      for (const s of parts) {
        if (s.length <= MAX_CHARS_PER_CHUNK) { out.push(s); continue; }
        const sub = s.split(/(?<=[、,])/);
        let acc = '';
        for (const x of sub) {
          if ((acc + x).length > MAX_CHARS_PER_CHUNK && acc) { out.push(acc); acc = x; }
          else acc += x;
        }
        if (acc) out.push(acc);
      }
      return out;
    }

    // ===== 劣化検出（強化）=====
    function isDegenerate(s, original){
      if (!s) return true;
      const t = s.trim();
      if (!t) return true;
      // ★ターゲット言語の特性違反（英語ターゲットで日本語が残っていれば劣化）
      if (target === 'en' && /[\u3040-\u30ff\u3400-\u9fff]/.test(t)) return true;
      // ★ターゲットが日本語でラテン文字主体ならおかしい（簡易チェック）
      if (target === 'ja' && t.length >= 6 && !/[\u3040-\u30ff\u3400-\u9fff]/.test(t) && /^[A-Za-z0-9 ,.!?'"\-]+$/.test(t)) return true;
      // 末尾が中途半端な前置詞/不完全な文
      if (/\b(?:to|of|in|on|at|for|with|by|from|the|a|an|and|or|but)\.?$/i.test(t)) return true;
      // 同じ3〜12語フレーズが3回以上連続
      if (/(\b[\w'-]{1,40}(?:\s+[\w'-]{1,40}){1,11}\b)([,\s.;!?]+\1){2,}/i.test(t)) return true;
      // 同じ単語が3回以上連続
      if (/\b(\w{2,})\b(?:[,\s.;!?]+\b\1\b){2,}/i.test(t)) return true;
      // ユニーク語率
      const tokens = t.toLowerCase().match(/[a-z]+/g) || [];
      if (tokens.length >= 10) {
        const uniq = new Set(tokens).size;
        if (uniq / tokens.length < 0.5) return true;
      }
      // 結果が原文より極端に短い
      const _minRatio = (target === 'ja') ? 0.20 : 0.35;  // 英->日は字数が縮むので緩める
      if (original && original.length >= 12 && t.length < original.length * _minRatio) return true;
      return false;
    }

    // ===== llama 翻訳（フォールバック）=====
    async function llamaTranslate(text){
      const res = await runWithFallback({
        messages: [
          { role:'system', content:`You are a literary translator. Translate the user's ${srcISO} text into natural, fluent ${tgtISO}. CRITICAL: Output MUST be entirely in ${tgtISO}; never include any ${srcISO} characters or romanized originals in the output. Preserve tone and cultural nuance (use natural ${tgtISO} idioms; never translate cultural expressions literally). Reply with ONLY the translation; no preface, no notes, no quotes, no explanations.` },
          { role:'user', content:text },
        ],
        max_tokens: Math.max(200, Math.min(1024, text.length * 4)),
        temperature: 0.2,
      });
      if (!res.ok) { if (debug) dbg.push({op:'llama-translate-allfail', error: String(res.error && res.error.message)}); return text; }
      const r = res.response;
      let out = (r && (r.response != null ? r.response : r.result)) || '';
      out = String(out).trim();
      out = out.replace(/^[`"'*]+|[`"'*]+$/g, '').trim();
      out = out.replace(/^(?:translation|english|英訳|訳)[: \-]+/i, '').trim();
      return out || text;
    }

    /* ===== ローマ字化（緩い検証）=====
     *
     * 人の名前でない語を渡さないこと。
     *   2026-10-20: カタログの authorEn が2作品で "Oonaa" になっていた。
     *   公開した時点で作者の欄に「オーナー」(役の名前) が入っていて、
     *   それをヘボン式に直した結果。出てきた字の形は正しいので、
     *   下の検証も通ってしまう。
     *   役や置き換えの語は、訳語を決めておいて AI に渡さない。
     *   ナレーターは全作品の話者一覧に入っているので特に大事。
     */
    const NOT_A_NAME = {
      'オーナー':'Owner', 'オーナーモード':'Owner',
      '作者':'Author', '著者':'Author', '作者名なし':'Unknown author',
      '読者':'Reader', '管理者':'Administrator', '運営':'Administrator', '運営者':'Administrator',
      'ナレーター':'Narrator', 'ナレーション':'Narration', '語り':'Narrator', '語り手':'Narrator',
      '全員':'Everyone', 'みんな':'Everyone', 'その他':'Other', 'モブ':'Bystander',
      '名前なし':'Unnamed', '無名':'Unnamed', '不明':'Unknown',
      '無題':'Untitled', '無題の作品':'Untitled work', '（無題）':'(untitled)',
    };
    async function romanizeName(name){
      if (!name || !name.trim()) return name;
      const fixed = NOT_A_NAME[name.trim()];
      if (fixed) { if (debug) dbg.push({op:'romanize-notaname', in: name, out: fixed}); return fixed; }
      if (!/[\u3040-\u30ff\u3400-\u9fff]/.test(name)) return name;
      const res = await runWithFallback({
        messages: [
          { role:'system', content:'Output ONLY Hepburn romaji for the Japanese personal name. No quotes, no markdown, no explanation, no labels. Family name first, given name second, separated by a single space. Capitalize the first letter of each name. Examples: 田中 健太 -> Tanaka Kenta. 佐藤 美咲 -> Sato Misaki. 山田太郎 -> Yamada Taro. 愛美 -> Aimi.' },
          { role:'user', content:name },
        ],
        max_tokens: 32,
        temperature: 0.0,
      });
      if (!res.ok) { if (debug) dbg.push({op:'romanize-allfail', in: name, error: String(res.error && res.error.message)}); return name; }
      const r = res.response;
      let raw = (r && (r.response != null ? r.response : r.result)) || '';
      let out = String(raw).trim();
      out = out.split(/[\r\n]+/)[0].trim();
      out = out.replace(/^[`"'*_\[\(『「]+|[`"'*_\]\)。、!?！？.,;:』」]+$/g, '').trim();
      out = out.replace(/^(?:romaji|name|hepburn|translation|romanized)[: \-]+/i, '').trim();
      if (out && /^[A-Za-z][A-Za-z \u00C0-\u017F\.\-']{0,60}$/.test(out) && !/[\u3040-\u30ff\u3400-\u9fff]/.test(out)) {
        if (debug) dbg.push({op:'romanize', in: name, raw, out, model: res.model});
        return out;
      }
      if (debug) dbg.push({op:'romanize-reject', in: name, raw, out, model: res.model});
      return name;
    }

    // ===== 1行翻訳 =====
    async function translateLine(line){
      if (!line || !line.trim()) return line;
      const sentences = splitSentences(line);
      const tr = [];
      for (const s of sentences) {
        if (!s.trim()) { tr.push(s); continue; }
        let out = s;
        try {
          const r = await env.AI.run(MODEL, { text: s, source_lang: srcLang, target_lang: tgtLang });
          out = (r && (r.translated_text != null ? r.translated_text : r.result)) || s;
        } catch (e) {
          if (debug) dbg.push({op:'m2m-error', in:s, error: String(e && e.message)});
          out = s;
        }
        if (debug) dbg.push({op:'m2m', in:s, out});
        // 劣化検出（日本語が残っている等）→ llama にフォールバック
        if (isDegenerate(out, s) || out === s) {
          const alt = await llamaTranslate(s);
          if (debug) dbg.push({op:'llama-fallback', in:s, m2m:out, llama:alt});
          if (!isDegenerate(alt, s)) {
            out = alt;
          } else {
            // llama も劣化 → もう一度 llama に再試行（明示的に「英語のみで」と再要求）
            const retry = await llamaTranslate('Translate the following sentence to ' + tgtISO + ' (output ONLY ' + tgtISO + ', no other characters): ' + s);
            if (debug) dbg.push({op:'llama-retry', in:s, retry});
            if (!isDegenerate(retry, s)) out = retry;
            // それでもダメなら、せめて原文の日本語を残すよりは英訳の形式に寄せる
            // → でも勝手な翻訳は危険なので原文を残す
          }
        }
        tr.push(out);
      }
      return tr.join(' ');
    }

    async function translateText(text){
      if (!text || !text.trim()) return text;
      const lines = text.split('\n');
      const out = [];
      for (const line of lines) out.push(await translateLine(line));
      return out.join('\n');
    }

    const titleTr = title ? await translateText(title) : '';

    // 人名のローマ字化はラテン文字ターゲットのときのみ。日本語ターゲットでは原名を保つ。
    const _wantRomaji = (target !== 'ja');
    const charactersOut = [];
    for (const c of characters) charactersOut.push({ id:c.id, name: _wantRomaji ? await romanizeName(c.name) : c.name });

    const results = new Array(items.length);
    let done = 0;
    let partial = false;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      // 時間切れで殺される前に切り上げる。残りは原文のまま返し、
      // partial を立てて、キャッシュには書かない。
      if (Date.now() - _startedAt > TIME_BUDGET_MS) { partial = true; break; }
      const chunk = items.slice(i, i + CONCURRENCY);
      const tr = await Promise.all(chunk.map(it => translateText(it.text)));
      tr.forEach((t, j) => { results[i + j] = { id: chunk[j].id, text: t }; });
      done += chunk.length;
    }
    // 間に合わなかったぶんは原文のまま埋める（空の穴を作らない）
    for (let i = 0; i < items.length; i++) {
      if (!results[i]) results[i] = { id: items[i].id, text: items[i].text };
    }

    const authorOut = (_wantRomaji && author) ? await romanizeName(author) : author;
    const out = { title: titleTr || title, author: authorOut, items: results, characters: charactersOut };

    // 訳せていないブロックを数える。原文の文字が残っていれば訳せていない。
    let untranslated = 0;
    if (target !== source) {
      for (const r of results) if (hasSourceScript(r.text, source)) untranslated++;
    }
    const clean = !partial && untranslated === 0;
    out.partial = partial || undefined;
    out.untranslated = untranslated || undefined;
    out.translatedCount = done;
    if (debug) out._debug = dbg;
    const payload = JSON.stringify(out);

    // ★訳し切れていないものはキャッシュに書かない。
    //   書いてしまうと、その日本語混じりが以後ずっと「正解」として返る。
    if (KV && !debug && clean) {
      await KV.put(cacheKey, payload, { expirationTtl: 60 * 60 * 24 * 90 }).catch(() => {});
    }
    return new Response(payload, { headers: { ...JSON_HEADERS,
      'X-Cache': clean ? 'MISS' : 'MISS-NOSTORE',
      'X-Partial': partial ? '1' : '0',
      'X-Untranslated': String(untranslated),
      'X-KV': KV ? (KV === env.WORKS ? 'WORKS' : 'WORKS_KV') : 'NONE',
      'X-AI-Model': _activeFallback || 'none' } });
  } catch (e) {
    return json({ error:'exception', message: String((e && e.message) || e), _debug: debug?dbg:undefined }, 500);
  }
}

// 英訳の置き場は2つある。全文キー(worktr7:)と、作品IDを鍵にした
// 分割キャッシュ(worktr_chunk:)。読む順序は**ビューアと同じ**にすること。
// ビューアは _trChunkLoad(分割) を先に見て、見つからなければ
// translateWork(全文キー) を叩く。点検がこれと逆の順序だと、
// 読者が実際に見ているのと違う訳を見て「健全」と報告してしまう。
// 2026-10-31 まで逆になっていた。
// もう一方の置き場の件数も返すので、食い違いに気づける。
async function readStored(KV, target, workId, fullKey) {
  const chunkItems = {}, chunkChars = {};
  let chunkTitle = '', chunkAuthor = '', parts = 0, total = 0;
  for (let p = 0; p < 60; p++) {
    const g = await KV.get(`worktr_chunk:${target}:${workId}:${p}`);
    if (!g) break;
    try {
      const h = JSON.parse(g);
      Object.assign(chunkItems, h.items || {});
      Object.assign(chunkChars, h.chars || {});
      if (h.title) chunkTitle = h.title;
      if (h.author) chunkAuthor = h.author;
      if (h.total) total = parseInt(h.total, 10) || total;
    } catch (e) { /* この分だけ飛ばす */ }
    parts = p + 1;
    if (total && parts >= total) break;
  }
  const keyItems = {}, keyChars = {};
  let keyTitle = '', keyAuthor = '', hasKey = false;
  try {
    const g = await KV.get(fullKey);
    if (g) {
      const h = JSON.parse(g);
      for (const x of (h.items || [])) if (x && x.id) keyItems[x.id] = x.text;
      for (const x of (h.characters || [])) if (x && x.id) keyChars[x.id] = x.name;
      keyTitle = h.title || ''; keyAuthor = h.author || '';
      hasKey = true;
    }
  } catch (e) { /* 壊れていれば無いものとして扱う */ }

  const useChunk = parts > 0;
  return {
    from: useChunk ? 'chunk' : (hasKey ? 'key' : 'none'),
    parts: parts,
    items: useChunk ? chunkItems : keyItems,
    chars: useChunk ? chunkChars : keyChars,
    title: useChunk ? chunkTitle : keyTitle,
    author: useChunk ? chunkAuthor : keyAuthor,
    別の置き場: useChunk
      ? (hasKey ? { 置き場: 'key', 件数: Object.keys(keyItems).length } : null)
      : null,
  };
}

function json(obj, status = 200){ return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS }); }

async function sha256hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
