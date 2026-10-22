/**
 * 読者が読む講評  /api/works/:id/critique
 * ============================================================
 * 2026-10-20 追加。
 *
 * なぜ要るのか
 *   作者が「この講評を読者にも見せる」を選んでも、読者に届ける経路が
 *   どこにも無かった。印だけが保存され、誰も読めない状態だった。
 *
 * 何を返すか
 *   publicCritique が選んだ分だけ。総合点・観点ごとの点と講評・
 *   良かったところ・総評。
 *   作者宛ての助言 (suggestions) と次の一手 (nextStep) は返さない。
 *   あれは直すために書かれたもので、読者に見せるものではない。
 *
 * 誰が読めるか
 *   誰でも。作者が公開を選んだものだけがここに出てくる。
 *   選んでいなければ 404 を返す。「無い」と「見せない」を
 *   区別しないのは、非公開であること自体を伏せるため。
 */

import { publicCritique } from '../../drafts/[id]/critique.js';

const WORK_ID_RE = /^(?:pub_|draft_)[A-Za-z0-9_-]{1,80}$/;

export async function onRequestGet(context) {
  const id = String((context.params && context.params.id) || '');
  if (!WORK_ID_RE.test(id)) {
    return new Response(JSON.stringify({ error: 'bad_id' }), {
      status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // 読む言語。viewer が ?lang=en を付けて呼ぶ。
  // その言語の講評が無ければ publicCritique が持っているものを返す。
  const lang = (new URL(context.request.url).searchParams.get('lang') || 'ja');

  let rec = null;
  try {
    rec = await publicCritique(context.env, id, lang);
  } catch (e) {
    console.warn('[works/critique] 読めませんでした:', e);
    rec = null;
  }

  if (!rec) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // 無いことも少しの間は覚えておく。作品を開くたびに KV を
        // 読みに行かせない。1日の読み取り回数は決して多くない。
        'Cache-Control': 'public, max-age=300',
        'Vary': 'Accept-Language',
      },
    });
  }

  return new Response(JSON.stringify({ ok: true, id: id, critique: rec }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
        'Vary': 'Accept-Language',
    },
  });
}
