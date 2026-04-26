# アニノベル バックエンド移行計画書

> 対象: 認証基盤(#2) + データ永続化(#3) + ストレージ(音声/画像)
> 作成日: 2026-04-26
> 状態: **提案フェーズ** — 実装着手前にユーザ承認が必要

---

## 1. 現状の課題

| # | 課題 | リスク |
|---|---|---|
| C1 | 認証が `localStorage.aninovel_user` のみ。誰でも DevTools で書換可能 | なりすまし、偽作者投稿、不正ログイン |
| C2 | 全データ(作品/投票/しおり)が localStorage = ブラウザ単体に閉じる | 端末交換・クリアで全消失。マルチデバイス不可 |
| C3 | パスワード平文保存疑い (要確認) | 漏洩時の二次被害 |
| C4 | 投稿コンテンツが他端末から読めない | 「投稿」の意味がない |
| C5 | 音声(IDB)/画像(localStorage) が容量制限に当たる(IDB ~50MB, localStorage ~5MB) | 大型作品の頓挫 |
| C6 | サーバ側のレート制限・モデレーション・通報処理ができない | スパム・違法投稿への対処不能 |
| C7 | 集計(投票数/PV)が信頼できない | 不正投票し放題 |

---

## 2. 採用技術スタックの選定

### 推奨: **Supabase**

| 比較項目 | Supabase | Firebase | 自前(Node+Postgres) |
|---|---|---|---|
| 無料枠 | 500MB DB / 1GB Storage / 50k MAU | 1GB DB / 5GB Storage / 50k MAU | $0(自宅) 〜 |
| 認証 | メール/OAuth/Magic Link 内蔵 | 同左 | 自前実装 |
| DB | PostgreSQL (本物のSQL) | NoSQL (Firestore) | PostgreSQL |
| ストレージ | S3互換 | Cloud Storage | S3別契約 |
| 行レベルセキュリティ(RLS) | あり | セキュリティルール記述 | 自前 |
| 静的サイトと相性 | ◎ (JSクライアントから直接) | ◎ | △ (API層必要) |
| 学習コスト | 低 (SQL慣れているなら) | 中 (NoSQL固有概念) | 高 |
| **総合** | **★★★★★** | ★★★★ | ★★ |

**理由:**
- PostgreSQL のためデータ移行・分析が容易
- 認証/DB/ストレージが1パッケージ
- 行レベルセキュリティ(RLS)で「自作品しか編集できない」を**SQLで宣言的に**書ける
- クライアントSDK で静的サイトから直接叩ける(中間APIサーバ不要)
- 無料枠で MAU 5万人まで運用可能 → スケール段階で Pro($25/月)

### サブ候補: Cloudflare D1 + Workers

将来 #6 で Cloudflare Pages にホスティング移行する場合、同社の D1 (SQLite) + Workers にまとめる選択肢もあり。ただし認証は自前実装が必要。**Phase 1 は Supabase、Phase 3+ で再評価。**

---

## 3. 段階的移行ロードマップ (4フェーズ)

### Phase A: 認証のみ移行 (期間: ~1週間)

**目的**: 偽認証を本物に置換、既存データ構造は localStorage 維持

- Supabase プロジェクト作成 (ユーザ作業)
- `js/services.js` の `signUp/signIn/signOut/getCurrentUser` を Supabase Auth に置換
- メール認証フロー(マジックリンクまたはメール+パスワード)
- 既存 `aninovel_user` を Supabase セッションへ自動マイグレーション
- ログアウト時は Supabase セッション無効化

**完了条件**: 異なるブラウザから同じアカウントでログインできる

### Phase B: 投稿作品(pub_)のサーバ化 (期間: ~2週間)

**目的**: 投稿された作品が他端末から読める状態にする

- Supabase テーブル設計:
  ```sql
  CREATE TABLE works (
    id UUID PRIMARY KEY,
    author_id UUID REFERENCES auth.users(id),
    title TEXT NOT NULL,
    data JSONB NOT NULL, -- {novel, characters, content, displaySettings}
    is_published BOOL DEFAULT FALSE,
    published_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    char_count INT,
    page_count INT
  );
  CREATE TABLE votes (
    work_id UUID REFERENCES works(id),
    user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (work_id, user_id)
  );
  CREATE TABLE bookmarks (
    user_id UUID REFERENCES auth.users(id),
    work_id UUID REFERENCES works(id),
    page INT,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, work_id, page)
  );
  ```
- RLS ポリシー:
  ```sql
  -- 公開作品は誰でも読める
  CREATE POLICY "public read" ON works FOR SELECT USING (is_published = true);
  -- 自作品は本人のみ書込可
  CREATE POLICY "own write" ON works FOR ALL USING (auth.uid() = author_id);
  ```
- `services.js`: getWork/publishWork/unpublishWork/castVote を DB 経由に
- 既存 localStorage の pub_ データは初回ログイン時に Supabase へインポート

**完了条件**: PCで投稿した作品が、別のスマホから(同一アカウントログイン後)読める

### Phase C: マイ作品(my_) と音声(IDB)のクラウド化 (期間: ~2週間)

**目的**: マルチデバイス編集 + 音声共有

- マイ作品も `works` テーブルに統合 (is_published=false で区別)
- 音声: Supabase Storage に `audio/{work_id}/{item_id}.wav` で保存
- 音声 manifest.json も同 bucket に
- viewer.html の audio 取得チェーンを「Storage URL → 旧IDB → Web Speech」に変更
- 音声権限: 公開作品は誰でも読める / マイ作品は本人のみ

**完了条件**: 音声付きで作品を投稿 → 他端末で音声付き再生

### Phase D: 同梱作品の DB 化 (期間: ~3日)

**目的**: 「同梱」と「投稿」の概念を統一、運営者が管理画面から編集可能に

- `data/works/*.json` を SQL INSERT に変換するスクリプト
- ホームの作品一覧クエリを catalog.json + DB から → DB のみに
- 旧静的JSONは削除しない(履歴として残す)

**完了条件**: catalog.json なしでも作品一覧が表示される

---

## 4. データモデル ER図 (テキスト版)

```
auth.users (Supabase標準)
  ├── id (UUID)
  ├── email
  └── created_at

profiles  (1:1 with auth.users)
  ├── user_id (FK auth.users)
  ├── display_name
  ├── role (reader/author/owner)
  ├── author_info (JSONB; 氏名/住所/電話)  ※ 暗号化推奨
  └── suspended (BOOL)

works
  ├── id (UUID)
  ├── author_id (FK auth.users)
  ├── title, summary, cover_image_url
  ├── data (JSONB; characters/content/displaySettings)
  ├── is_published (BOOL)
  ├── published_at
  ├── updated_at
  ├── char_count, page_count
  └── suspended (BOOL; モデレーションで停止)

votes (work_id, user_id) PK

bookmarks (user_id, work_id, page) PK

reports
  ├── id, reporter_id, target_type(work/comment/user), target_id
  ├── reason, detail, status (open/in_review/resolved)
  └── created_at, resolved_at

audit_log
  └── 重要操作の監査記録 (ログイン/投稿/削除/権限変更)
```

---

## 5. セキュリティ設計

| 項目 | 対策 |
|---|---|
| パスワード | Supabase Auth (bcrypt 12 rounds) |
| 認可 | Postgres RLS で全テーブル保護 |
| 認証トークン | Supabase JWT、自動更新 |
| CSRF | Supabase は SameSite Cookie + JWT 併用で原則無防備領域なし |
| XSS | 投稿テキストは `escape()` 後にレンダ。HTML入力禁止 |
| レート制限 | Supabase Edge Functions で per-IP/per-user 制限 |
| 著者情報暗号化 | author_info を pgcrypto で AES-256 暗号化、運営側でも復号制限 |
| BAN | profiles.suspended = true で全API拒否 |

---

## 6. 既存ユーザのデータ移行

```js
// 初回ログイン時に1回だけ実行
async function migrateLocalToCloud() {
  if (localStorage.getItem('aninovel_migrated_v1')) return;
  const myWorks = JSON.parse(localStorage.getItem('aninovel_my_works')||'{}');
  const pubWorks = JSON.parse(localStorage.getItem('aninovel_published_works')||'{}');
  // ... Supabase insert
  localStorage.setItem('aninovel_migrated_v1', new Date().toISOString());
}
```

ユーザに「クラウド移行を行いますか？」のダイアログで明示同意を取る。

---

## 7. 費用試算 (Supabase)

| 規模 | プラン | 月額 |
|---|---|---|
| MAU 1k / 100MB DB | Free | $0 |
| MAU 50k / 8GB DB / 100GB Storage | Pro | $25 |
| MAU 100k+ / 大規模 | Team以上 | $599〜 |

→ **黒字化の目安**: 広告収入 or 課金で月 $25 以上見込めるまで Free で運用可能。

---

## 8. 実装着手前にユーザに確認すべきこと

1. **Supabase アカウント作成** (https://supabase.com/) は OK か?
2. **メール認証で本物のメールアドレス登録**を必須化して問題ないか? (現状は誰でも適当アドレスで登録可)
3. **既存 localStorage データは移行 vs 破棄、どちらを基本動作とするか?**
4. **Phase A → D の順で1つずつ進めて良いか?** (一気に全置換は失敗時のリカバリ困難)
5. **Supabase の URL / anon key を環境変数化したいか?** (公開URLとなる anon key は GitHub にコミット可だが、別 .env 管理推奨)

---

## 9. 想定リスクと対策

| リスク | 対策 |
|---|---|
| 移行中の既存ユーザのデータ消失 | 移行前に必ずエクスポート(.aninovel)を案内 |
| Supabase 障害 | Free 期間中はステータスページ監視のみ。Pro移行で SLA 99.9% |
| GDPR/個人情報保護法 | プライバシーポリシーの「業務委託先」に Supabase を明記済 |
| ベンダーロックイン | 全データ Postgres = いつでも pg_dump でエクスポート可 |
| 無料枠超過 | アラート設定。突発トラフィックは CDN(Cloudflare) でキャッシュ吸収 |

---

## 10. 着手判定

**実装は Phase A から開始する前提で、以下が揃ったら GO:**

- [ ] ユーザが Supabase プロジェクトを作成し、URL+anon key を提供
- [ ] 移行ロードマップ Phase A〜D の優先順位確認
- [ ] 「移行ユーザのlocalStorageを破壊的に消すか維持するか」のポリシー決定
- [ ] テストアカウントでまず動作確認 → 本番反映、の順序合意

**Phase A 完了でひとまず「真の認証」になり、商用化の前提が整います。**
