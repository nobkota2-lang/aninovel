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
 * ★安全装置★
 *   ANINOVEL_WRITE_TOKEN が未設定のときは、従来どおり全ての書き込みを通す。
 *   つまりこのコードを配置しただけでは何も壊れない。
 *   環境変数を設定した時点で有効になり、削除すれば即座に元の挙動へ戻る。
 */

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
export function requireWrite(context) {
  const need = context.env && context.env.ANINOVEL_WRITE_TOKEN;

  // 未設定 = 認証オフ。段階導入のための安全装置。
  if (!need) return null;

  const h = context.request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  const got = m ? m[1].trim() : '';

  if (!got) {
    return json({
      error: 'unauthorized',
      message: '書き込みには認証が必要です。作者・オーナー以外は変更できません。'
    }, 401);
  }
  if (!safeEqual(got, need)) {
    return json({
      error: 'forbidden',
      message: '書き込み権限がありません。'
    }, 403);
  }
  return null;
}

/** 認証が有効になっているか (診断用) */
export function writeAuthEnabled(context) {
  return !!(context.env && context.env.ANINOVEL_WRITE_TOKEN);
}
