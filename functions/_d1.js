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
 */

export const PEEK_LIMIT = 5;          // 登録なしで1日に読める作品数

/* ------------------------------------------------------------------
 * 1件の読書を何ポイントに数えるか
 * ------------------------------------------------------------------
 * 2026-10-20 追加。api/points.js と api/admin/points.js の両方が
 * ここから読む。式を2か所に書くと、作者が見る画面と運営者の集計が
 * いつか食い違う。食い違えば、支払いの根拠が崩れる。
 *
 * この式は legal/revenue.html「収益分配とポイントの算定方法」の
 * 第3条・第4条をそのまま写したもの。あの文書は利用規約の一部なので、
 * 式を変えるときは必ず文書を先に直し、両方を同時に出すこと。
 *
 *   ポイント ＝ 読んだ割合 × 読者の種別による重み
 *     読んだ割合   0.0〜1.0（最後まで読むと 1.0）
 *     重み         登録会員 1.0 ／ 登録していない読者 0.5
 *
 *   読んだ割合の上限（第4条）
 *     送られてきた値をそのまま使わず、実際に開いていた時間で抑える。
 *     読み切ったと認める最短の時間 = その作品の文字数 ÷ 毎秒25文字
 *     ただしどの作品も 3分 を下限とし、
 *     文字数が記録されていない作品は 5分 として扱う。
 *
 *   数えない記録（第2条）
 *     開いていた時間が30秒に満たないもの。
 *
 * 1日の滞在時間の6時間上限は、書き込むときに済ませている
 * （下の logRead の MIN(seconds + ?5, 21600)）。ここでは掛けない。
 *
 * 表に別名を付けて使うこと: reads を r、works_meta を w。
 * ------------------------------------------------------------------ */
const READ_FULL_SECONDS = `CASE
    WHEN w.char_count IS NULL OR w.char_count <= 0 THEN 300.0
    ELSE MAX(180.0, w.char_count / 25.0)
  END`;

export const SCORE_SQL = `CASE
    WHEN r.seconds < 30 THEN 0.0
    ELSE MIN(r.progress, r.seconds / (${READ_FULL_SECONDS}), 1.0)
         * (CASE WHEN r.member = 1 THEN 1.0 ELSE 0.5 END)
  END`;

export const SCORE_NOTE_JA =
  '1件のポイント = 読んだ割合 × 読者の重み（登録会員 1.0 / 未登録 0.5）。'
  + '読んだ割合は、実際に開いていた時間で上限を設けます'
  + '（読み切ったと認める最短の時間 = 文字数 ÷ 毎秒25文字、下限3分、'
  + '文字数が無い作品は5分）。開いていた時間が30秒未満の記録は数えません。'
  + '詳しくは収益分配とポイントの算定方法をご覧ください。';

export const SCORE_NOTE_EN =
  'Points for one read = the share you read × a weight for the reader '
  + '(1.0 for registered members, 0.5 otherwise). The share you read is capped '
  + 'by the time the work was actually open (the shortest time credited as a full '
  + 'read = characters ÷ 25 per second, with a floor of 3 minutes, or 5 minutes '
  + 'when the character count is not recorded). Records under 30 seconds are not '
  + 'counted. See the revenue-share and points document for details.';

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

/* ---------------- 読書ログ ---------------- */

/**
 * 読書を記録する。同じ読者の同じ作品は1日1行。
 * 2回目以降は行を増やさず、滞在秒数と進み具合を足し込む。
 * 行を増やさないのは、読み直しでポイントが水増しされるのを防ぐため。
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
       VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(work_id, reader, day) DO UPDATE SET
         updated_at = ?4,
         seconds    = MIN(seconds + ?5, 21600),
         progress   = MAX(progress, ?6),
         finished   = MAX(finished, ?7)`
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
                               created_at, published_at, last_edited_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(work_id) DO UPDATE SET
         draft_id       = COALESCE(?2, draft_id),
         owner_email    = COALESCE(?3, owner_email),
         title          = COALESCE(?4, title),
         status         = COALESCE(?5, status),
         published_at   = COALESCE(?7, published_at),
         last_edited_at = ?8`
    ).bind(
      meta.workId, meta.draftId || null,
      meta.ownerEmail ? String(meta.ownerEmail).toLowerCase() : null,
      meta.title || null, meta.status || null,
      meta.createdAt || now, meta.publishedAt || null, now
    ).run();
  } catch (e) {
    console.warn('[d1] 作品メタの記録に失敗:', e && e.message);
  }
}
