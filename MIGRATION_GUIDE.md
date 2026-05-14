# GitHub Pages → Cloudflare Pages 移行ガイド

Phase 2 着手の第一歩は、ホスティングを GitHub Pages から Cloudflare Pages へ移すこと。
これにより **セキュリティヘッダー** と **Pages Functions (バックエンドAPI)** が使えるようになる。

GitHub Pagesでは原理的に不可能な機能:
- `Content-Security-Policy` などのセキュリティヘッダー
- サーバーサイドのAPI処理 (課金、メール送信、認証など)
- 動的OGP画像生成
- レート制限
- KVストレージ

これら全てが Cloudflare Pages で解決する。

---

## ステップ 1: Cloudflareアカウント作成 (5分)

1. https://dash.cloudflare.com/sign-up でアカウント作成 (無料)
2. メール確認
3. (任意) 2段階認証を有効化

---

## ステップ 2: 独自ドメイン取得 (15分)

### 推奨: Cloudflare Registrar
- 原価販売 (例: .com は 約$10/年)、更新料も同じ
- DNS と一体運用、設定が一発

### 取得手順
1. ダッシュボード → Domain Registration → Register Domains
2. `aninovel.com` や `aninovel.jp` を検索
3. 購入 (約 10〜15ドル / 年)

### 代替: 既に他社で取得済みの場合
- お名前.com、Google Domains等で取得済みなら、Cloudflareに移管 (転送)
- または Cloudflare のネームサーバーに NS変更だけしてDNSだけ使う

---

## ステップ 3: GitHub リポジトリの準備 (10分)

現在 `nobkota2-lang/aninovel` のリポジトリに、Phase 2 ファイルを追加:

```bash
cd /path/to/aninovel  # 既存のクローン

# Phase 2 のファイルを追加
mkdir -p functions/api/billing functions/api/og scripts .github/workflows

# 配置 (本キットの内容):
#   _headers              → ルート直下
#   _redirects            → ルート直下
#   wrangler.toml         → ルート直下
#   package.json          → ルート直下
#   functions/_middleware.js
#   functions/api/newsletter.js
#   functions/api/reports.js
#   functions/api/errors.js
#   functions/api/billing/create-checkout.js
#   functions/api/billing/billing-portal.js
#   functions/api/billing/stripe-webhook.js
#   functions/api/og/[work].js
#   scripts/build.sh
#   scripts/fill-legal-placeholders.cjs
#   .github/workflows/deploy.yml

# 法務ページのプレースホルダを置換
npm install
npm run fill-legal      # 対話入力

git add .
git commit -m "Phase 2: Cloudflare Pages migration"
git push
```

---

## ステップ 4: Cloudflare Pages プロジェクト作成 (5分)

1. Cloudflare ダッシュボード → Workers & Pages → Create Application → Pages → Connect to Git
2. GitHubアカウントを連携 → `aninovel` リポジトリを選択
3. **ビルド設定**:
   ```
   Project name: aninovel
   Production branch: main
   Build command: npm run build
   Build output directory: dist
   Root directory: /
   Environment variables (build):
     NODE_VERSION = 20
   ```
4. **Save and Deploy** をクリック

→ 1〜2分でビルド完了。`https://aninovel.pages.dev` で確認できる。

---

## ステップ 5: 独自ドメインを接続 (5分)

1. Pages プロジェクト → Custom domains → Set up a custom domain
2. `aninovel.com` (および `www.aninovel.com`) を追加
3. Cloudflareが自動でDNSレコード (CNAME) を設定
4. SSL証明書も自動発行 (Universal SSL)

数分でアクセス可能に。

---

## ステップ 6: KV namespace 作成 (5分)

Newsletter / Reports / Errors / Billing / RateLimit のデータを保存するため、5つのKVを作成。

1. Workers & Pages → KV → Create namespace
2. 以下を作成:
   - `aninovel-newsletter`
   - `aninovel-reports`
   - `aninovel-errors`
   - `aninovel-billing`
   - `aninovel-ratelimit`
3. Pages プロジェクト → Settings → Functions → KV namespace bindings:
   ```
   Variable name        KV namespace
   NEWSLETTER_KV     →  aninovel-newsletter
   REPORTS_KV        →  aninovel-reports
   ERRORS_KV         →  aninovel-errors
   BILLING_KV        →  aninovel-billing
   RATE_LIMIT_KV     →  aninovel-ratelimit
   ```
4. **Save** → 次回のデプロイから反映

---

## ステップ 7: 環境変数を設定 (10分)

Pages プロジェクト → Settings → Environment variables。
**Production** タブで以下を追加 (機密情報は **Encrypt** を選択):

### 必須
```
SITE_URL = https://aninovel.com
```

### 通知用 (どれか1つでOK)
```
DISCORD_WEBHOOK_URL = https://discord.com/api/webhooks/...
# または
SLACK_WEBHOOK_URL = https://hooks.slack.com/services/...
# または
NOTIFY_EMAIL = admin@aninovel.com  (Resendと組み合わせて)
```

### メール配信 (Newsletter)
```
RESEND_API_KEY     = re_...                       (Encrypted)
RESEND_AUDIENCE_ID = aud_...                     (任意)
FROM_EMAIL         = noreply@aninovel.com
```

### Stripe (有料プラン稼働時)
```
STRIPE_SECRET_KEY     = sk_live_...   または sk_test_...   (Encrypted)
STRIPE_WEBHOOK_SECRET = whsec_...                          (Encrypted)
```

### 運営者用API保護
```
ADMIN_TOKEN = (ランダム32文字、`openssl rand -hex 32` で生成)  (Encrypted)
```

### エラー監視通知 (任意)
```
DISCORD_ERROR_WEBHOOK_URL = https://discord.com/api/webhooks/...   (Encrypted)
```

---

## ステップ 8: フロントエンドの設定値を書き換え (5分)

`index.html` および `viewer.html` のスクリプト設定をアンコメント:

```html
<!-- 旧 (現状コメントアウト中) -->
<!-- window.ANINOVEL_BILLING_API='https://api.aninovel.com'; -->

<!-- 新 (Cloudflare Pages Functionsへ) -->
<script>
  // バックエンドAPI (同一オリジン経由)
  window.ANINOVEL_BILLING_API='/api/billing';
  window.ANINOVEL_NEWSLETTER_API='/api/newsletter';
  window.ANINOVEL_MODERATION_ENDPOINT='/api/reports';
  window.ANINOVEL_ERROR_ENDPOINT='/api/errors';
  window.ANINOVEL_ERROR_SAMPLE=0.1;  // 本番は10%サンプリング

  // Stripe Price ID (ダッシュボードで作成後の値に置換)
  window.ANINOVEL_STRIPE_PRICES={
    'reader-premium-monthly': 'price_xxxxx',
    'reader-premium-yearly':  'price_xxxxx',
    'author-pro-monthly':     'price_xxxxx',
    'author-pro-yearly':      'price_xxxxx'
  };

  // 解析 (取得後の値に置換)
  window.ANINOVEL_GA4_ID='G-XXXXXXXXXX';
  window.ANINOVEL_CF_BEACON='YOUR_CLOUDFLARE_BEACON_TOKEN';

  // AdSense (審査通過後に置換)
  // window.ANINOVEL_ADSENSE_PUBLISHER='ca-pub-XXXXXXXXXXXXXXXX';
  // window.ANINOVEL_AD_SLOTS={inline:'XXXXXXXXXX',sidebar:'XXXXXXXXXX',footer:'XXXXXXXXXX'};
</script>
```

各値の取得方法:
- **GA4**: https://analytics.google.com/ でプロパティ作成 → 測定ID
- **Cloudflare Beacon**: Cloudflare ダッシュボード → Analytics → Web Analytics → Add Site
- **Stripe Price ID**: Stripeダッシュボード → Products → 各Productを作成し、価格を追加
- **AdSense**: https://adsense.google.com/ で審査申請 (15〜30日)

---

## ステップ 9: 動作確認 (10分)

### ローカル確認
```bash
npm run dev    # wrangler pages dev で http://localhost:8788
```

### 本番確認
1. https://aninovel.com で表示確認
2. https://securityheaders.com/?q=aninovel.com でセキュリティヘッダー確認 → A+ を目指す
3. https://pagespeed.web.dev/ でパフォーマンス確認 → 90+ を目指す
4. ニュースレター登録テスト → 確認メール受信確認
5. 通報テスト → Discord通知確認
6. (Stripe設定済みの場合) Test mode で決済テスト

### Stripe Webhook 設定
1. Stripeダッシュボード → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://aninovel.com/api/billing/stripe-webhook`
3. Listen to events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. 表示される **Signing secret** をコピー → `STRIPE_WEBHOOK_SECRET` 環境変数にセット

---

## ステップ 10: GitHub Pages の旧サイトを停止 (任意)

新サイトが安定動作したら:
1. GitHubリポジトリ → Settings → Pages → Source を **None** に
2. または `index.html` を `<meta http-equiv="refresh" content="0;url=https://aninovel.com/">` に書き換え

---

## トラブルシューティング

### "_headers が反映されない"
- `_headers` はビルド出力ルート (`dist/`) にコピーされる必要がある。`scripts/build.sh` で実施済み。
- 反映確認: `curl -I https://aninovel.com/` で `content-security-policy` 等が返るか確認

### "Functions が 404"
- `functions/` ディレクトリは **ビルド出力外** に置く (Cloudflare Pagesが自動検出)
- `functions/api/foo.js` → URL `/api/foo`
- `functions/api/billing/create-checkout.js` → URL `/api/billing/create-checkout`
- `functions/api/og/[work].js` → URL `/api/og/:any` (動的パラメータ)

### "CSP違反でJSが動かない"
- ブラウザのDevTools Console に違反内容が表示される
- 必要なドメインを `_headers` の Content-Security-Policy に追加
- 初期は `'unsafe-inline'` を許可しているので大半は動くはず

### "Stripe Webhook が 400 で返る"
- 署名検証失敗。`STRIPE_WEBHOOK_SECRET` がStripeのSigning secret と一致しているか確認
- リクエストボディの読み取り順に注意 (`request.text()` を最初に1回だけ)

---

## チェックリスト

- [ ] Cloudflareアカウント作成
- [ ] 独自ドメイン取得 (`aninovel.com` 等)
- [ ] Phase 2 ファイルを既存リポジトリに追加
- [ ] `npm install` 実行
- [ ] `npm run fill-legal` で法務ページのプレースホルダ埋め込み
- [ ] git commit & push
- [ ] Cloudflare Pages プロジェクト作成・接続
- [ ] 独自ドメインを Pages に接続
- [ ] KV namespace 5つを作成・Pages にbinding
- [ ] 環境変数を設定 (機密情報は Encrypt)
- [ ] フロントエンドの設定値を本物のIDに置換
- [ ] Stripe Webhook エンドポイント登録 (有料プランを動かす場合)
- [ ] GA4 / Cloudflare Beacon の計測タグID取得・設置
- [ ] securityheaders.com で A+ 確認
- [ ] PageSpeed Insights で 90+ 確認
- [ ] (任意) GitHub Pages の旧サイトを停止

---

## 移行後にできるようになること

- ✅ ニュースレター登録 (Resend経由でダブルオプトイン)
- ✅ 通報受付 (Discord/Slack/メールで運営者に即時通知)
- ✅ Stripe Checkout (実際に課金可能)
- ✅ Stripe顧客ポータル (解約/カード変更)
- ✅ 動的OGP画像 (作品ごとの専用画像)
- ✅ エラー監視 (KVに集約、Discord通知)
- ✅ セキュリティヘッダー A+
- ✅ 独自ドメインで運用
- ✅ レート制限 (DDoS / スパム対策)

## 次の Phase (Phase 2.5)

このPhase 2 が完成したら、次は:
- Supabase または Cloudflare D1 で **ユーザー認証 + 永続データ**
- localStorage からのデータ移行
- クロスデバイス同期
- 作家向け収益分配の実装

これは別途用意します。
