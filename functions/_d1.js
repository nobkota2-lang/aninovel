/**
 * D1（読書ログとポイント）の共通処理  functions/_d1.js
 * ============================================================
 *
 * 方針
 *   D1 がまだ用意されていない間も、サイトは今までどおり動く。
 *   バインドが無ければ、この層の関数は静かに「何もしない」を返す。
 *   読書の記録や立ち読みの数え上げが、作品を読むことを妨げてはいけない。
 *
 *   同じ理由で、数え上げに失敗したときは「読ませる」側に倒す。
 *   上限の判定ができないからといって読者を締め出すのは、
 *   取りこぼしよりも損が大きい。
 *
 * 日付
 *   日本時間（UTC+9）で日と月を切る。
 *   UTC で切ると、日本の夜9時に「1日5作品」の上限が戻ってしまう。
 *
 * 申告を鵜呑みにしない（2026-10-03 追加）
 *   滞在秒数と進み具合は、ビューアが送ってくる自己申告の値である。
 *   そのまま記録すると、`{seconds:3600, progress:1.0}` を1回投げるだけで
 *   読了したことになり、ポイントを作れてしまう。
 *
 *   そこでサーバー側で、行を立てた時刻からの実経過時間を測り、
 *   それを超える分は切り捨てる。進み具合も「人が読める速さ」で頭を打たせる。
 *   作品を読み切るのに要する最短時間は、文字数から出す。
 *   1秒に25文字は、人がどれだけ速く読んでも超えない速さである。
 *
 *   ビューアは1分ごとに差分を送る作りなので、正直な読者はこの上限に
 *   当たらない。当たるのは、短時間で大量に申告してきた相手だけ。
 */

export const PEEK_LIMIT = 5;          // 登録なしで1日に読める作品数

/* ---- 申告を実時間で頭打ちにするための値 ---- */
const CHARS_PER_SECOND    = 25;    // 人が読める上限の速さ（1秒25文字＝1分1500文字）
const MIN_FULL_SECONDS    = 180;   // どんなに短い作品でも、読んだと認めるには3分要る
const DEFAULT_FULL_SECONDS= 300;   // 文字数が分からない作品の既定
// 最初の1回で認める秒数。ビューアの送信間隔そのものにする。これを
// 送信間隔より大きくすると、短い作品を一度の申告で読了にできてしまう。
const FIRST_REPORT_GRACE  = 60;
const SECONDS_CAP         = 21600; // 1作品1日6時間

/** その作品を読み切るのに要する最短秒数。文字数が無ければ既定値。 */
const FULL_SECONDS = `COALESCE((SELECT MAX(${MIN_FULL_SECONDS}.0, char_count / ${CHARS_PER_SECOND}.0)
                                  FROM works_meta WHERE work_id = ?1 AND char_count > 0),
                               ${DEFAULT_FULL_SECONDS}.0)`;

/** 行を立ててから今までの実経過秒数（＋最初の1回ぶんの猶予）。
 *  started_at が読めなければ 0 とみなす。NULL を混ぜると MIN が NULL になり、
 *  NOT NULL 制約に当たって記録そのものが落ちるため、必ず COALESCE で受ける。 */
const ELAPSED = `(COALESCE(CAST((julianday(?4) - julianday(started_at)) * 86400 AS INTEGER), 0)
                  + ${FIRST_REPORT_GRACE})`;

/** 更新後の滞在秒数。足し込んだ値・1日の上限・実経過時間のうち、一番小さいもの。 */
const NEW_SECONDS = `MIN(seconds + ?5, ${SECONDS_CAP}, ${ELAPSED})`;

/** 更新後の進み具合。申告値と「実時間で読めるところまで」の小さいほう。 */
const NEW_PROGRESS = `MIN(?6, (${NEW_SECONDS}) / (${FULL_SECONDS}))`;

export function db(env) {
  return (env && (env.DB || env.D1 || env.ANINOVEL_DB)) || null;
}

/** 日本時間の YYYY-MM-DD */
export function jstDay(d) {
  const t = (d instanceof Date) ? d : new Date();
  const jst = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
/** 日本時間の YYYY-MM */
export function jstMonth(d) {
  return jstDay(d).slice(0, 7);
}

/**
 * 読者を見分ける印。生の IP は残さない。
 * ログイン中はメール、そうでなければ IP を伏せた印。
 */
export async function readerMark(request, env, user) {
  if (user && user.email) return 'u:' + String(user.email).trim().toLowerCase();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  const salt = (env && env.READER_SALT) || (env && env.OBJECTION_SALT) || 'aninovel-reader';
  const buf = new TextEncoder().encode(salt + '|' + ip + '|' + ua.slice(0, 80));
  const h = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'a:' + hex.slice(0, 20);
}

/* ---------------- 点数の式 ---------------- */

/**
 * 読書ログ1行あたりの点数。
 *
 *   読んだ割合（0.0〜1.0） × （会員 1.0 ／ 立ち読み 0.5）
 *   ただし滞在30秒未満は 0 点（開いて閉じただけを除く）
 *
 * これは収益分配の根拠になる式なので、ここにしか置かない。
 * 運営者の集計（api/admin/points.js）と作者が見る画面（api/points.js）が
 * 別々に式を持つと、いつか必ず食い違う。読み出し側は reads に r、
 * works_meta に w の別名を付けること。
 *
 * 申告された progress と seconds は logRead の時点で実時間に
 * 丸められている。ここでは丸め済みの値を前提にしてよい。
 */
export const SCORE_SQL = `CASE WHEN r.seconds < 30 THEN 0
       ELSE r.progress * (CASE WHEN r.member = 1 THEN 1.0 ELSE 0.5 END) END`;

/** 点数の付け方の説明。画面にそのまま出す。 */
export const SCORE_NOTE_JA =
  '1件の読書につき、読んだ割合（0〜1）×（会員1.0／立ち読み0.5）。'
  + '30秒未満は数えません。同じ方が同じ作品を同じ日に何度読んでも1件です。'
  + '読んだ割合は、実際にページを開いていた時間で頭打ちになります。';
export const SCORE_NOTE_EN =
  'Each read scores: portion read (0–1) x (1.0 for members, 0.5 for guests). '
  + 'Sessions under 30 seconds do not count. The same person reading the same work '
  + 'on the same day counts once. The portion read is capped by the time actually spent on the page.';

/* ---------------- 立ち読みの上限 ---------------- */

/**
 * 登録なしの読者が、この作品を開いてよいかを見る。
 * 同じ日に一度開いた作品は、何度戻ってきても上限を消費しない。
 *
 * @returns {{allowed:boolean, used:number, limit:number, remaining:number,
 *            counted:boolean, unavailable?:boolean}}
 */
export async function checkPeek(env, request, reader, workId) {
  const d = db(env);
  const day = jstDay();
  // D1 がまだ無い間は数えない。読むことを妨げない。
  if (!d) return { allowed: true, used: 0, limit: PEEK_LIMIT, remaining: PEEK_LIMIT,
                   counted: false, unavailable: true };

  try {
    const seen = await d.prepare(
      'SELECT 1 FROM peek_counts WHERE reader = ?1 AND day = ?2 AND work_id = ?3'
    ).bind(reader, day, workId).first();

    const row = await d.prepare(
      'SELECT COUNT(*) AS n FROM peek_counts WHERE reader = ?1 AND day = ?2'
    ).bind(reader, day).first();
    const used = (row && Number(row.n)) || 0;

    // すでに今日読んだ作品なら、数えずに通す
    if (seen) {
      return { allowed: true, used, limit: PEEK_LIMIT,
               remaining: Math.max(0, PEEK_LIMIT - used), counted: false };
    }
    if (used >= PEEK_LIMIT) {
      return { allowed: false, used, limit: PEEK_LIMIT, remaining: 0, counted: false };
    }

    await d.prepare(
      'INSERT OR IGNORE INTO peek_counts (reader, day, work_id, at) VALUES (?1, ?2, ?3, ?4)'
    ).bind(reader, day, workId, new Date().toISOString()).run();

    return { allowed: true, used: used + 1, limit: PEEK_LIMIT,
             remaining: Math.max(0, PEEK_LIMIT - used - 1), counted: true };
  } catch (e) {
    // 数えられなかった。読ませる側に倒す。
    console.warn('[d1] 立ち読みの数え上げに失敗:', e && e.message);
    return { allowed: true, used: 0, limit: PEEK_LIMIT, remaining: PEEK_LIMIT,
             counted: false, unavailable: true };
  }
}

/**
 * その読者が今日その作品を「開いてよい」と判定されたか。
 *
 * 作品を開くときは上限を見ているのに、読んだ量を記録するときは見ていなかった。
 * つまり progress を直接投げれば、1日5作品の上限を通らずに全作品ぶん
 * 記録できた。登録なしの読者については、ここを通ったものだけ記録する。
 */
export async function peekSeen(env, reader, workId) {
  const d = db(env);
  if (!d) return false;
  try {
    const row = await d.prepare(
      'SELECT 1 FROM peek_counts WHERE reader = ?1 AND day = ?2 AND work_id = ?3'
    ).bind(reader, jstDay(), workId).first();
    return !!row;
  } catch (e) {
    // 判定できないときは記録しない。取りこぼすほうが、水増しより安全。
    console.warn('[d1] 立ち読み済みかの判定に失敗:', e && e.message);
    return false;
  }
}

/* ---------------- 読書ログ ---------------- */

/**
 * 読書を記録する。同じ読者の同じ作品は1日1行。
 * 2回目以降は行を増やさず、滞在秒数と進み具合を足し込む。
 * 行を増やさないのは、読み直しでポイントが水増しされるのを防ぐため。
 *
 * 申告された秒数と進み具合は、実経過時間で頭打ちにする（上の方針を参照）。
 * 「読み終えた」の印も同じで、時間が伴っていなければ立てない。
 */
export async function logRead(env, reader, workId, opts) {
  const d = db(env);
  if (!d) return { ok: false, skipped: true };
  const o = opts || {};
  const now = new Date().toISOString();
  const day = jstDay();
  const seconds = Math.max(0, Math.min(6 * 60 * 60, Number(o.seconds) || 0));  // 1回6時間を上限
  const progress = Math.max(0, Math.min(1, Number(o.progress) || 0));
  const finished = o.finished ? 1 : 0;
  const member = (String(reader).indexOf('u:') === 0) ? 1 : 0;

  try {
    await d.prepare(
      `INSERT INTO reads (work_id, reader, day, started_at, updated_at, seconds, progress, finished, member)
       VALUES (?1, ?2, ?3, ?4, ?4,
               MIN(?5, ${FIRST_REPORT_GRACE}),
               MIN(?6, ${FIRST_REPORT_GRACE}.0 / (${FULL_SECONDS})),
               CASE WHEN MIN(?6, ${FIRST_REPORT_GRACE}.0 / (${FULL_SECONDS})) >= 0.98
                    THEN ?7 ELSE 0 END,
               ?8)
       ON CONFLICT(work_id, reader, day) DO UPDATE SET
         updated_at = ?4,
         seconds    = ${NEW_SECONDS},
         progress   = MAX(progress, ${NEW_PROGRESS}),
         finished   = MAX(finished,
                          CASE WHEN ${NEW_PROGRESS} >= 0.98 THEN ?7 ELSE 0 END)`
    ).bind(workId, reader, day, now, seconds, progress, finished, member).run();
    return { ok: true };
  } catch (e) {
    console.warn('[d1] 読書ログの記録に失敗:', e && e.message);
    return { ok: false, error: String(e && e.message) };
  }
}

/** 会員の「最後に読んだ日」を更新する。 */
export async function touchMember(env, email, kind) {
  const d = db(env);
  if (!d || !email) return;
  const now = new Date().toISOString();
  try {
    await d.prepare(
      `INSERT INTO members (email, kind, registered_at, last_active_at)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT(email) DO UPDATE SET last_active_at = ?3`
    ).bind(String(email).toLowerCase(), kind || 'reader', now).run();
  } catch (e) {
    console.warn('[d1] 会員の更新に失敗:', e && e.message);
  }
}

/** 作者が作品を登録・編集したことを記録する（幽霊作者の判定に使う）。 */
export async function touchAuthored(env, email) {
  const d = db(env);
  if (!d || !email) return;
  const now = new Date().toISOString();
  try {
    await d.prepare(
      `INSERT INTO members (email, kind, registered_at, last_active_at, last_authored_at)
       VALUES (?1, 'author', ?2, ?2, ?2)
       ON CONFLICT(email) DO UPDATE SET
         kind = 'author', last_active_at = ?2, last_authored_at = ?2`
    ).bind(String(email).toLowerCase(), now).run();
  } catch (e) {
    console.warn('[d1] 作者の活動日の記録に失敗:', e && e.message);
  }
}

/** 作品のメタを書き込む（審査の状態が変わったとき）。 */
export async function upsertWorkMeta(env, meta) {
  const d = db(env);
  if (!d || !meta || !meta.workId) return;
  const now = new Date().toISOString();
  try {
    await d.prepare(
      `INSERT INTO works_meta (work_id, draft_id, owner_email, title, status,
                               created_at, published_at, last_edited_at, char_count, title_en)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(work_id) DO UPDATE SET
         draft_id       = COALESCE(?2, draft_id),
         owner_email    = COALESCE(?3, owner_email),
         title          = COALESCE(?4, title),
         status         = COALESCE(?5, status),
         published_at   = COALESCE(?7, published_at),
         last_edited_at = ?8,
         char_count     = COALESCE(?9, char_count),
         title_en       = COALESCE(?10, title_en)`
    ).bind(
      meta.workId, meta.draftId || null,
      meta.ownerEmail ? String(meta.ownerEmail).toLowerCase() : null,
      meta.title || null, meta.status || null,
      meta.createdAt || now, meta.publishedAt || null, now,
      // 文字数は「読み切るのに要する最短時間」の算出に使う。
      (Number(meta.charCount) > 0) ? Math.round(Number(meta.charCount)) : null,
      // 英語の題。作者が英語で画面を見たときに、作品名だけ日本語で残らないように。
      meta.titleEn || null
    ).run();
  } catch (e) {
    console.warn('[d1] 作品メタの記録に失敗:', e && e.message);
  }
}
