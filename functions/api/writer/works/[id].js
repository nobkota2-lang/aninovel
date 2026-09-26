/**
 * 作者用の書き込み口  /api/writer/works/:id
 * --------------------------------------------------
 * 中身は /api/author/works/:id と同じ処理をそのまま使う。
 * 違うのは「Cloudflare Access の外にある」ことだけ。
 *
 * なぜ分けるか:
 *   Access はパス単位でしか効かないので、api/author/* を守ると
 *   Access のポリシーに載っていない作者は、自分の作品ですら
 *   保存・公開ができない。かといって作者全員を Access に登録すると、
 *   サイトのログインとは別に毎回メールの使い捨て番号が要る。
 *   そこで、オーナー専用の操作は Access の内側(api/author/*, api/admin/*)に残し、
 *   作者が自分の作品を書く口だけを外側(api/writer/*)に出す。
 *
 * 守りが緩むわけではない:
 *   呼ばれる処理は同じで、
 *     ・作者かオーナーとしてログインしていること
 *     ・その作品の ownerEmail が自分であること(オーナーは全作品)
 *   を毎回確かめる。読者は通らない。
 */
export { onRequestGet, onRequestPut, onRequestDelete } from '../../author/works/[id].js';
