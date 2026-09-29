-- ============================================================
-- AniNovel D1 スキーマ  migrations/0001_init.sql
-- ------------------------------------------------------------
-- なぜ KV ではなく D1 か
--   KV の無料枠は「1日1,000書き込み」しかない。読書ログは読者が
--   作品を開くたびに書くので、読者が数十人いるだけで枯れる。
--   D1 の無料枠は 1日10万行書き込み・500万行読み取りで、桁が違う。
--   また「今月このIPは何作品読んだか」「この作者の今期のポイントは」と
--   いった集計は、SQL のほうが素直に書ける。
--
-- 日付について
--   day / period は日本時間（UTC+9）で切る。
--   「1日5作品まで」を UTC で切ると、日本の夜9時に上限が戻ってしまう。
--
-- 適用のしかた（Cloudflare のダッシュボードから）
--   Workers & Pages → D1 → 対象のデータベース → Console に貼って実行
--   または wrangler d1 execute aninovel --file=migrations/0001_init.sql --remote
-- ============================================================

-- ---- 会員 --------------------------------------------------
-- 本体（メール・パスワード・権限）は KV にある。ここは日付だけを持つ。
-- 二重管理を避けるため、KV にある項目は写さない。
CREATE TABLE IF NOT EXISTS members (
  email            TEXT PRIMARY KEY,
  kind             TEXT NOT NULL DEFAULT 'reader',  -- reader / author
  registered_at    TEXT NOT NULL,
  billing_start_at TEXT,        -- 課金が始まる日。NULL なら無料のまま
  last_active_at   TEXT,        -- 最後に読んだ日
  last_authored_at TEXT         -- 最後に作品を登録・編集した日（幽霊作者の判定）
);
CREATE INDEX IF NOT EXISTS idx_members_kind     ON members(kind);
CREATE INDEX IF NOT EXISTS idx_members_authored ON members(last_authored_at);

-- ---- 作品のメタ --------------------------------------------
-- 作品の本体は KV。ここは状態と日付だけ。集計で JOIN する相手。
CREATE TABLE IF NOT EXISTS works_meta (
  work_id        TEXT PRIMARY KEY,   -- pub_xxxx
  draft_id       TEXT,               -- draft_xxxx（無い昔の作品は NULL）
  owner_email    TEXT,               -- 編集してよい人。表示する作者名とは別
  title          TEXT,
  status         TEXT,               -- draft / review / published / rejected
  created_at     TEXT,
  published_at   TEXT,
  last_edited_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_works_owner  ON works_meta(owner_email);
CREATE INDEX IF NOT EXISTS idx_works_status ON works_meta(status);

-- ---- 読書ログ ----------------------------------------------
-- ポイントの元になる記録。
-- 同じ読者の同じ作品は1日1行まで（ポイントの水増しを防ぐ）。
-- 2回目以降は行を増やさず、滞在秒数と進み具合を足し込む。
CREATE TABLE IF NOT EXISTS reads (
  work_id    TEXT NOT NULL,
  reader     TEXT NOT NULL,   -- 'u:<メール>' か 'a:<伏せた印>'
  day        TEXT NOT NULL,   -- YYYY-MM-DD（日本時間）
  started_at TEXT NOT NULL,
  updated_at TEXT,
  seconds    INTEGER NOT NULL DEFAULT 0,
  progress   REAL    NOT NULL DEFAULT 0,   -- 0.0〜1.0
  finished   INTEGER NOT NULL DEFAULT 0,   -- 最後まで読んだら 1
  member     INTEGER NOT NULL DEFAULT 0,   -- 登録会員なら 1
  PRIMARY KEY (work_id, reader, day)
);
CREATE INDEX IF NOT EXISTS idx_reads_day       ON reads(day);
CREATE INDEX IF NOT EXISTS idx_reads_work_day  ON reads(work_id, day);

-- ---- 立ち読みの上限 ----------------------------------------
-- 登録していない読者は1日5作品まで。
-- どの作品を読んだかを残すのは、同じ作品に戻ってきたときに
-- 上限を消費させないため（読み返しで締め出さない）。
CREATE TABLE IF NOT EXISTS peek_counts (
  reader  TEXT NOT NULL,   -- 'a:<伏せた印>'
  day     TEXT NOT NULL,   -- YYYY-MM-DD（日本時間）
  work_id TEXT NOT NULL,
  at      TEXT NOT NULL,
  PRIMARY KEY (reader, day, work_id)
);
CREATE INDEX IF NOT EXISTS idx_peek_day ON peek_counts(reader, day);

-- ---- ポイント台帳 ------------------------------------------
-- 期間ごとに reads を集計して確定させる。
-- ポイントと金額を分けて持つのは、1点あたりの単価を後から
-- 決められるようにするため（単価は期間の収益で割って決まる）。
CREATE TABLE IF NOT EXISTS points (
  period       TEXT NOT NULL,   -- YYYY-MM（日本時間）
  author_email TEXT NOT NULL,
  work_id      TEXT NOT NULL,
  points       REAL NOT NULL DEFAULT 0,
  reads_count  INTEGER NOT NULL DEFAULT 0,
  confirmed    INTEGER NOT NULL DEFAULT 0,   -- 締めたら 1。以後は動かさない
  computed_at  TEXT,
  PRIMARY KEY (period, author_email, work_id)
);
CREATE INDEX IF NOT EXISTS idx_points_period ON points(period);
CREATE INDEX IF NOT EXISTS idx_points_author ON points(author_email, period);
