/**
 * 自分が持っている公開済みの作品  /api/mine
 * ============================================================
 *
 * なぜ要るのか
 *   「マイ作品」は下書き台帳（KV の drafts:<メール>）だけを見ている。
 *   下書きの仕組みができる前に公開した作品は、そこに記録が無いので
 *   一覧に出てこない。作者から見ると、自分の作品が消えている。
 *
 *   いまは works_meta に持ち主が入っているので、ここから引ける。
 *   下書きのある作品はこれまでどおり下書き台帳が受け持つ。この口は
 *   「公開されているのに下書きが無い作品」を拾うためのもの。
 *
 * なぜ /api/author/ ではないのか
 *   api/author/* は Cloudflare Access の対象で、一般の作者は通れない。
 *   /api/points と同じ理由で、Access の外に置く。
 *
 * 見せる範囲
 *   自分が owner_email になっている作品だけ。
 *   オーナーもこの口では自分の分しか見えない。
 *
 * 使い方
 *   GET /api/mine  … { works:[{workId,title,titleEn,status,publishedAt,draftId,charCount}] }
 */

import { requireWriter, json } from '../_owner.js';
import { db } from '../_d1.js';

const SQL = `
SELECT work_id, title, title_en, status, published_at, created_at,
       last_edited_at, draft_id, char_count
  FROM works_meta
 WHERE owner_email = ?1
 ORDER BY COALESCE(published_at, created_at) DESC`;

export async function onRequestGet(context) {
  const g = await requireWriter(context); if (g.deny) return g.deny;
  const me = String(g.who.email || '').toLowerCase();

  const d = db(context.env);
  // D1 が無いときは「0件」ではなく「調べられない」と返す。
  // 0件と出すと、作品が消えたように見えてしまう。
  if (!d) return json({ unavailable: true, works: [] });

  try {
    const rows = await d.prepare(SQL).bind(me).all();
    const list = ((rows && rows.results) || []).map((r) => ({
      workId: r.work_id,
      title: r.title || r.work_id,
      titleEn: r.title_en || null,
      status: r.status || 'published',
      publishedAt: r.published_at || null,
      updatedAt: r.last_edited_at || r.published_at || r.created_at || null,
      draftId: r.draft_id || null,
      charCount: Number(r.char_count) > 0 ? Number(r.char_count) : null,
    }));
    return json({ works: list });
  } catch (e) {
    return json({ error: 'query_failed', message: String(e && e.message) }, 500);
  }
}
