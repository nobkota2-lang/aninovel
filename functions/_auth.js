/**
 * AniNovel 書き込み認証  functions/_auth.js
 * --------------------------------------------------
 * サーバーの内容を変更する操作 (PUT / POST / DELETE) を、
 * 共有シークレットを知っている者だけに限定する。
 *
 * 設定方法:
 *   Cloudflare ダッシュボード
 *     → Workers & Pages → aninovel → Settings → Environment variables
 *     → Production に  ANINOVEL_WRITE_TOKEN = <長いランダム文字列>  を「暗号化」で追加
 *
 * ★既定は「拒否」★
 *   以前は ANINOVEL_WRITE_TOKEN が未設定なら全ての書き込みを通していた。
 *   段階導入のための作りだったが、環境変数を消した瞬間に誰でも書ける
 *   状態になる向きなので、未設定なら拒否するよう反転した。
 *   トークンが無くても、作者かオーナーとしてログインしていれば通る。
 */

import { whoAmI } from './_owner.js';

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// 文字列比較にかかる時間から中身を推測されないようにする
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 書き込み権限を確認する。
 * @returns {Response|null} 拒否する場合は Response、通す場合は null
 */
export async function requireWrite(context) {
  const need = context.env && context.env.ANINOVEL_WRITE_TOKEN;

  // 1) 端末に入れた書き込みトークン
  const h = context.request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  const got = m ? m[1].trim() : '';
  if (need && got && safeEqual(got, need)) return null;

  // 2) 作者かオーナーとしてのログイン
  try {
    const who = await whoAmI(context.request, context.env);
    if (who && Array.isArray(who.roles) &&
        (who.roles.indexOf('author') !== -1 || who.roles.indexOf('owner') !== -1)) return null;
  } catch (e) {}

  // どちらでもない。トークンが未設定でも通さない（既定は拒否）。
  if (!need && !got) {
    return json({
      error: 'unauthorized',
      message: '書き込みには作者かオーナーのログインが必要です。'
    }, 401);
  }
  if (!got) {
    return json({
      error: 'unauthorized',
      message: '書き込みには認証が必要です。作者・オーナー以外は変更できません。'
    }, 401);
  }
  return json({ error: 'forbidden', message: '書き込み権限がありません。' }, 403);
}

/** 認証が有効になっているか (診断用) */
export function writeAuthEnabled(context) {
  return !!(context.env && context.env.ANINOVEL_WRITE_TOKEN);
}
