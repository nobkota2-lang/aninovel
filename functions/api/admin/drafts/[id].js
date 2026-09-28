/**
 * 審査対象の下書きを読む (オーナー用)  /api/admin/drafts/:id
 * ------------------------------------------------------------
 * 中身は /api/drafts/:id の GET と同じ。Cloudflare Access に守られた
 * "api/admin/*" の下に置くための1行。書き込みは持たせない。
 */
export { onRequestGet } from '../../drafts/[id].js';
