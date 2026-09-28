/**
 * 審査する (オーナー用)  /api/admin/drafts/:id/review
 * ------------------------------------------------------------
 * 中身は /api/drafts/:id/review と同じ。Cloudflare Access に守られた
 * "api/admin/*" の下から呼べるようにするための1行。
 */
export { onRequestPost, onRequestDelete } from '../../../drafts/[id]/review.js';
