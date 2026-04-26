# 独自ドメイン取得 + CDN移行 手順書

> 対象: GitHub Pages (現状) → Cloudflare Pages + 独自ドメイン
> 想定所要時間: ドメイン取得30分 + CDN移行60分 + DNS伝播最大48時間
> 状態: ユーザ作業ガイド (Claude は設定ファイル準備のみ実施可)

---

## 1. なぜ独自ドメイン+Cloudflare Pages か

| 項目 | GitHub Pages (現状) | Cloudflare Pages (推奨) |
|---|---|---|
| URL | nobkota2-lang.github.io/aninovel | aninovel.com (独自) |
| HTTPS | 自動 | 自動 |
| 帯域 | 100GB/月、月100GB超は警告 | **無制限・無料** |
| ビルド回数 | 10回/時 | 500回/月 |
| Edge Functions | なし | あり (将来 Stripe webhook 等で活用) |
| CDN拠点数 | 限定的 | 世界300+拠点 |
| アクセス解析 | なし | Cloudflare Web Analytics 無料 |
| WAF/DDoS防御 | 限定的 | 無料プランでも基本対応 |
| 料金 | 無料 | **無料** (Free プランで十分) |

→ **Cloudflare Pages 一択**。Vercel/Netlify も優秀だが、商用前提なら帯域・WAF・後述の Workers との統合で Cloudflare に分があります。

---

## 2. ドメイン取得

### 2-1. 候補ドメイン

優先度順に調査済の例(2026年時点、要再確認):

| 候補 | コメント |
|---|---|
| `aninovel.com` | 第一候補。.com は信頼性◎ |
| `aninovel.jp` | 日本特化を強調 |
| `aninovel.net` | .com が取れない場合 |
| `aninovel.app` | Web/モバイル感を出す場合 |
| `ani-novel.com` | ハイフン入り(避けたい) |

### 2-2. レジストラ選定

| サービス | 年額 (.com 目安) | 推奨度 | 備考 |
|---|---|---|---|
| **Cloudflare Registrar** | $9.15 (原価) | ★★★★★ | マークアップなし。CDN 同社で完結 |
| Google Domains → Squarespace | $12 | ★★★ | Google撤退 |
| お名前.com | ¥1,000-1,500 | ★★ | 更新時値上げに注意。日本円決済可 |
| Value Domain | ¥1,200 | ★★ | 国内大手、サポート日本語 |

→ **Cloudflare Registrar 推奨** (最安値・更新時値上げなし・WHOIS代理無料)

### 2-3. 取得手順 (Cloudflare Registrar)

1. https://www.cloudflare.com/ にサインアップ (まだなら)
2. ダッシュボード → "Register Domains" → 希望ドメインを検索
3. 利用可能なら $9.15 でカード決済 → 即時取得
4. WHOIS情報は Cloudflare がプロキシ → 個人情報非公開で安全

---

## 3. Cloudflare Pages へのデプロイ

### 3-1. リポジトリ連携

1. Cloudflare ダッシュボード → "Workers & Pages" → "Create" → "Pages" → "Connect to Git"
2. GitHub アカウント認証 → `nobkota2-lang/aninovel` リポジトリを選択
3. ビルド設定:
   - **Framework preset**: None (静的サイト)
   - **Build command**: 空欄
   - **Build output directory**: `/` (リポジトリルート)
   - **Root directory**: 空欄
4. "Save and Deploy" → 数十秒で `aninovel.pages.dev` が公開される

### 3-2. カスタムドメイン設定

1. Pages プロジェクト → "Custom domains" → "Set up a custom domain"
2. `aninovel.com` を入力 → 自動でDNSレコード作成 (Cloudflare Registrar で取得した場合は自動完了)
3. 必要なら `www.aninovel.com` も追加 → CNAME で `aninovel.com` へリダイレクト
4. SSL証明書は自動発行 (Universal SSL)

### 3-3. リダイレクト設定 (旧URL → 新URL)

GitHub Pages の旧URL `nobkota2-lang.github.io/aninovel/` から新ドメインへリダイレクト:

`_redirects` ファイルを作成 (Cloudflare Pages が自動認識):

```
# Cloudflare Pages _redirects
# 旧 GitHub Pages 経由のアクセスを新ドメインへ301リダイレクト
# (これは旧側に置く必要があるため GitHub Pages 側に別途 meta refresh で対応)
```

GitHub Pages 側の `index.html` 先頭にメタリフレッシュ(廃止予告):

```html
<meta http-equiv="refresh" content="0;url=https://aninovel.com/">
<link rel="canonical" href="https://aninovel.com/">
```

### 3-4. SEO 移行 (重要)

- Google Search Console で **新旧両ドメインを登録**
- 新ドメインで `sitemap.xml` を再送信
- 旧→新の **301 リダイレクト** が認識されると、検索順位は自動で引き継がれる(数週間)
- 既存の sitemap.xml / canonical / og:url の URL を新ドメインに **一括置換**

```bash
# 例: GitHub Pages URL を新ドメインへ置換
sed -i 's|https://nobkota2-lang.github.io/aninovel|https://aninovel.com|g' \
  index.html viewer.html manual.html legal/*.html sitemap.xml
```

---

## 4. Cloudflare の追加設定

### 4-1. キャッシュルール

Pages はデフォルトで CDN キャッシュ済だが、明示設定でさらに最適化:

| パターン | TTL | 理由 |
|---|---|---|
| `*.html` | 5分 | 更新を比較的早く反映 |
| `*.css *.js` | 1ヶ月(immutable) | バージョン付きで配信 |
| `*.png *.jpg *.svg *.webp` | 1ヶ月 | 画像は変化が少ない |
| `*.wav` (事前生成音声) | 1年 | 一度生成したら不変 |
| `data/catalog.json` | 1分 | 作品追加を早く反映 |

`_headers` ファイル(Cloudflare Pages):

```
/*.wav
  Cache-Control: public, max-age=31536000, immutable

/*.css
  Cache-Control: public, max-age=2592000, immutable

/*.js
  Cache-Control: public, max-age=2592000, immutable

/data/catalog.json
  Cache-Control: public, max-age=60

/
  Cache-Control: public, max-age=300
```

### 4-2. セキュリティヘッダー (推奨)

`_headers` に追記:

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'
```

CSP は Supabase / Google Analytics / Tailwind CDN を使う前提で記述。利用サービスが増えたら都度追加。

### 4-3. WAF (Web Application Firewall)

Cloudflare Free プランでも以下が無料:
- Bot 攻撃ブロック (基本ルール)
- 既知の悪意ある IP ブロック
- DDoS 防御 (L3/L4 自動)

設定: ダッシュボード → Security → WAF → "Managed Rules" を有効化。

### 4-4. Web Analytics

Cloudflare Web Analytics は **Cookie レス・無料・GDPR対応**:
1. ダッシュボード → Web Analytics → "Add a site"
2. 発行されるスニペットを `<head>` に追加
3. 個人情報追跡なし、ボット除外済

→ #7 で GA4 と並べて検討予定。Cloudflare 側を主、GA4 をサブにする選択肢が現実的。

---

## 5. 移行チェックリスト

- [ ] ドメイン取得完了
- [ ] Cloudflare Pages にリポジトリ連携、`*.pages.dev` で動作確認
- [ ] カスタムドメイン設定、HTTPS で `aninovel.com` 表示確認
- [ ] `_headers` `_redirects` を設定
- [ ] サイト内全URLを新ドメインに置換 (sed コマンド)
- [ ] sitemap.xml の URL を更新
- [ ] Google Search Console: 新ドメイン登録、sitemap 送信
- [ ] GitHub Pages の index.html に meta refresh で旧→新リダイレクト
- [ ] OGPデバッガで新URLが正しく表示されるか確認
  - https://developers.facebook.com/tools/debug/
  - https://cards-dev.twitter.com/validator
- [ ] 1週間後、検索順位が引き継がれているか確認

---

## 6. 注意点

1. **DNS 伝播**: 最大48時間かかる場合あり (実際は数時間)
2. **Mixed Content**: 旧 `nobkota2-lang.github.io` が canonical に残っていると SEO重複 → 必ず置換
3. **Service Worker 残存**: 旧URLでアクセスしたユーザのブラウザに古い SW が残るため、`viewer.html` 既存の SW 解除コードが効く
4. **メールアドレス**: ドメインを取ったら `contact@aninovel.com` 等のメールも作りたいが、Cloudflare Registrar は転送のみ。Google Workspace ($6/月) や Cloudflare Email Routing (無料、転送のみ) を併用

---

## 7. 着手判定

- [ ] 商用展開の意思が固まり、月 ¥1,000 のドメイン代を負担できる
- [ ] Supabase 移行 (#2+#3) より**先に**ドメインを決める方が、Supabase 側の許可URL設定が一度で済む
- [ ] Cloudflare アカウント作成済

**推奨タイミング**: 法務文書(#1)とSEO(#5)が整った今、**次にやるべき作業**。
ドメインが決まらないと、Supabase の認証リダイレクトURL や OGP の絶対URL が確定しないため。
