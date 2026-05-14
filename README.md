# アニノベル Phase 2 — Cloudflare Pages 移行 + バックエンド実装キット

Phase 1 (静的サイト基盤) はあなたの既存実装で完了済みでした。
本キットは **Phase 2: バックエンド + 本番ホスティング** のための実装一式。

---

## 解決する問題

現状、`billing.js` / `newsletter.js` / `moderation.js` のフロント実装は完成しているものの、
これらが叩く先の API (`api.aninovel.com`) が存在しないため、機能が「準備中」アラートで止まっている。

本キットは:
1. **Cloudflare Pages へ移行** (GitHub Pagesではセキュリティヘッダー設定不可、Functions不可)
2. **API 7本を Pages Functions で実装** (フロントの既存設計をそのまま稼働)
3. **動的OGP画像生成** (作品ごとに専用OGP)
4. **本番ビルドパイプライン** (minify + 難読化 + バージョニング)
5. **法務ページのプレースホルダ自動置換**

---

## ファイル構成

```
phase2/
├── README.md                              本ファイル
├── MIGRATION_GUIDE.md                     ★ 移行手順書 (ステップバイステップ)
├── _headers                               Cloudflare Pages セキュリティヘッダー
├── _redirects                             URL正規化
├── wrangler.toml                          Cloudflare Pages 設定
├── package.json                           npm スクリプト
│
├── functions/                             ★ Cloudflare Pages Functions
│   ├── _middleware.js                    CORS + レート制限 + 認証
│   └── api/
│       ├── newsletter.js                  Resend連携 (ダブルオプトイン)
│       ├── reports.js                     通報受付 + Discord/Slack通知
│       ├── errors.js                      フロントエラー集約
│       ├── billing/
│       │   ├── create-checkout.js         Stripe Checkout
│       │   ├── billing-portal.js          Stripe Customer Portal
│       │   └── stripe-webhook.js          Webhook (署名検証付き)
│       └── og/
│           └── [work].js                  動的OGP生成 (作品別)
│
├── scripts/
│   ├── build.sh                           本番ビルド (minify/obfuscate)
│   └── fill-legal-placeholders.cjs        法務プレースホルダ置換 (対話式)
│
└── .github/
    └── workflows/
        └── deploy.yml                     GitHub Actions 自動デプロイ
```

---

## クイックスタート

詳細は `MIGRATION_GUIDE.md` を参照。最短ルートのみ:

```bash
# 1. 既存のアニノベルディレクトリでこのキットの内容を統合
cd /path/to/aninovel
cp -r phase2/. .

# 2. 依存インストール
npm install

# 3. 法務ページのプレースホルダ置換 (対話)
npm run fill-legal

# 4. ローカル動作確認
npm run build
npm run dev    # http://localhost:8788

# 5. Cloudflare Pages にデプロイ
#    (初回はダッシュボードでプロジェクト作成 + GitHub接続が必要、MIGRATION_GUIDE.md参照)
git add . && git commit -m "Phase 2: backend + Cloudflare Pages"
git push    # → GitHub Actionsが自動デプロイ
```

---

## 各API の役割と稼働条件

| エンドポイント | フロント側呼出 | 必要な環境変数 / KV |
|---|---|---|
| `POST /api/newsletter` | `js/newsletter.js` `subscribe()` | `RESEND_API_KEY`, `FROM_EMAIL`, `NEWSLETTER_KV` |
| `POST /api/reports` | `js/moderation.js` `enqueue()` | `REPORTS_KV` + `DISCORD_WEBHOOK_URL` (or `SLACK_WEBHOOK_URL` or メール) |
| `POST /api/errors` | `js/error-monitor.js` `record()` | `ERRORS_KV` + `DISCORD_ERROR_WEBHOOK_URL` (任意) |
| `POST /api/billing/create-checkout` | `js/billing.js` `startCheckout()` | `STRIPE_SECRET_KEY` |
| `POST /api/billing/billing-portal` | `js/billing.js` `openCustomerPortal()` | `STRIPE_SECRET_KEY` |
| `POST /api/billing/stripe-webhook` | Stripeから | `STRIPE_WEBHOOK_SECRET`, `BILLING_KV` |
| `GET /api/og/[work].svg` | `<meta og:image>` から自動 | (なし、`/data/works/*.json` 参照のみ) |

すべての API は **環境変数が未設定なら 503 / 適切なエラーJSON** を返す。
段階的に有効化していけばよい。

---

## デプロイ後にできること

| 機能 | フロント実装 | API実装 (本キット) | 動作状態 |
|---|---|---|---|
| 利用規約ページ | ✅ | — | 稼働 |
| プライバシーポリシー | ✅ | — | 稼働 |
| 特商法表記 | ✅ | — | 稼働 |
| DMCA通報窓口 | ✅ | — | 稼働 |
| GA4解析 | ✅ | — | ID入れれば稼働 |
| Cloudflare Insights | ✅ | — | トークン入れれば稼働 |
| 同意バナー | ✅ | — | 稼働 |
| アンチパイラシー | ✅ | — | 稼働 |
| 多言語(ja/en) | ✅ | — | 稼働 |
| エラー監視 | ✅ | ✅ | DSN入れれば稼働 |
| **ニュースレター** | ✅ | ✅ | **本キットで稼働** |
| **通報受付** | ✅ | ✅ | **本キットで稼働** |
| **Stripe決済** | ✅ | ✅ | **本キットで稼働** |
| **動的OGP** | — | ✅ | **本キットで新規** |
| **セキュリティヘッダー** | — | ✅ | **本キットで稼働** |
| ユーザー認証 (本物) | 部分 | — | Phase 2.5 で実装 |
| 投票永続化 (DB) | localStorage | — | Phase 2.5 で実装 |

---

## Phase 2.5 (次の段階)

本Phase 2 が稼働したら、次は **Cloudflare D1 (SQLite) または Supabase** で:
- ユーザー認証 (メール+パスワード、Magic Link)
- 投票・しおり・カスタマイズ設定のクロスデバイス同期
- 作家機能 (投稿フロー、収益分配)
- 作品の永続的なメタデータ管理

これらは「Phase 2.5」として別途キット化します。先に Phase 2 を稼働させてください。

---

## 重要な留意事項

### セキュリティ
- 本番では必ず **Encrypted** 環境変数として機密キーを保存
- `STRIPE_SECRET_KEY` の test/live を本番環境で混同しない
- Stripe Webhook の署名検証は必須 (本キットで実装済み)
- 一般公開のAPIには CSRF / Origin チェック (本キット `_middleware.js`)

### コスト見積もり
- Cloudflare Pages: 月500ビルド + 無制限帯域: **無料**
- Cloudflare Pages Functions: 月10万リクエスト: **無料** (Bundled plan は $5/月で1000万)
- Cloudflare KV: 月10万読込 + 1000書込: **無料**
- Resend: 月3000通: **無料**
- Stripe: 売上の3.6% + ¥0/通 (日本)
- Cloudflare Image Resizing (OGP PNG化したい場合): $5/月

→ 初期段階は **ほぼ無料** で運営可能。

### バックアップ
- KVのデータは2年保持設定 (本キット既定値)
- 重要データは別途エクスポート手段を用意推奨
- Phase 2.5 で D1/Supabase へ移行時に正式DB化

---

## サポート

各ファイルは独立して機能するので、必要なものから順次導入できる。
特に質問・カスタマイズ要望があれば継続対応します。
