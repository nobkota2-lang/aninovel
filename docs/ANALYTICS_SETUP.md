# アクセス解析セットアップ手順

> 対象: GA4 (Google Analytics 4) + Cloudflare Web Analytics
> 状態: コード実装済 (`js/analytics.js`) / **ID埋込待ち**

---

## 1. 構成

| 解析 | 役割 | Cookie |
|---|---|---|
| **GA4** | ユーザ属性・コンバージョン・カスタムイベント詳細解析 | あり |
| **Cloudflare Web Analytics** | リアルタイムPV・参照元・端末。プライバシー重視 | **なし** |

両方並行運用が推奨です。Cloudflare 側は Cookie レスのため法的リスク低、GA4 はマーケ用途で詳細データ取得。

---

## 2. 同意バナーの動作

1. 初回訪問時にページ読込から800msでバナー表示
2. **同意** → 解析スクリプトを動的ロード → GA4/CF が動作開始
3. **拒否** → 何もロードしない (恒久的に無効)
4. 同意状態は localStorage に13ヶ月保存
5. 設定変更: ユーザは `window.AninovelAnalytics.revoke()` 等で再変更可

GDPR/CCPA/日本の改正個人情報保護法で求められる「事前の同意」を実装しています。

---

## 3. GA4 セットアップ

### 3-1. 測定ID 取得

1. https://analytics.google.com/ にGoogleアカウントでサインイン
2. 「管理」→ 「プロパティを作成」
3. プロパティ名: `アニノベル` / タイムゾーン: `日本` / 通貨: `JPY`
4. 「データストリームを作成」→ ウェブ → URL `https://aninovel.com` (または現状GitHub Pages URL)
5. 表示される **測定ID `G-XXXXXXXXXX`** をコピー

### 3-2. コードに埋込

`index.html` `viewer.html` `manual.html` の以下のコメントを外す:

```html
<script>
  window.ANINOVEL_GA4_ID='G-XXXXXXXXXX'; // ← ここに測定IDを貼付
</script>
<script src="js/analytics.js" defer></script>
```

3ファイル一括置換:

```bash
for f in index.html viewer.html manual.html; do
  sed -i "s|// window.ANINOVEL_GA4_ID='G-XXXXXXXXXX'|window.ANINOVEL_GA4_ID='G-実際のID'|" "$f"
done
```

### 3-3. プライバシーポリシー更新

`legal/privacy.html` の「業務委託先」表に Google Analytics が既に列挙されているため、特に追記不要。プレースホルダの `[Google Analytics 4 / Plausible 等]` を `Google Analytics 4` に置換するだけ。

### 3-4. 推奨カスタムイベント (将来)

`gtag('event', ...)` で以下を計測可能:

| イベント | 計測タイミング | 用途 |
|---|---|---|
| `work_view` | 作品ビューワを開いた | 作品別PV |
| `work_complete` | 最終ページ到達 | 完読率 |
| `vote` | 投票ボタン押下 | エンゲージメント |
| `tts_play` | 音声再生開始 | 機能利用率 |
| `share` | SNSシェアボタン押下 | バイラル |
| `signup` | 新規登録完了 | コンバージョン |
| `publish` | 作品投稿完了 | 作者活動 |

実装は #14, #15 と合わせて段階的に追加。

---

## 4. Cloudflare Web Analytics セットアップ

### 4-1. ビーコントークン取得

1. Cloudflare ダッシュボード → "Web Analytics" → "Add a site"
2. URL: `https://aninovel.com` を入力
3. JavaScript snippet が表示される。中の `data-cf-beacon` の `token` 値(英数字)をコピー
4. 例: `data-cf-beacon='{"token":"abcdef1234567890"}'` → `abcdef1234567890`

### 4-2. コードに埋込

```html
<script>
  window.ANINOVEL_CF_BEACON='abcdef1234567890';
</script>
```

(GA4 と同じ `<script>` ブロックに併記可能)

### 4-3. Cloudflare Pages 移行後の特典

Cloudflare Pages にホスティングすると、Pages プロジェクト → "Web Analytics" を有効化するだけで**コード追加不要**で計測開始できます (このパターンを使う場合 `ANINOVEL_CF_BEACON` 設定は不要)。

---

## 5. 動作確認

1. 同意バナーが表示されること
2. 「同意」を押下 → DevTools Network で以下が読み込まれることを確認:
   - `googletagmanager.com/gtag/js`
   - `static.cloudflareinsights.com/beacon.min.js`
3. GA4 リアルタイムレポートで自分のアクセスが見えること (1-2分かかる)
4. Cloudflare Analytics ダッシュボードで PV カウントが上がること

---

## 6. 設定変更コンソールコマンド

```js
AninovelAnalytics.status()    // → true / false / null
AninovelAnalytics.revoke()    // 同意取消、ページリロード
AninovelAnalytics.grant()     // 同意付与、ページリロード
AninovelAnalytics.showBanner() // バナー再表示
```

将来「設定」画面から呼び出せるようにする予定 (#11 と同時)。
