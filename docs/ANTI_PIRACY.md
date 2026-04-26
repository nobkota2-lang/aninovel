# 海賊サイト対策

> 状態: クライアント側の基本対策済 (`js/anti-piracy.js`)
> 本格対策は #2+#3 (サーバ動的配信) 完了後に実施

---

## 重要な前提

**完全な保護は静的サイトでは不可能です。** ブラウザに送られた時点で全てのHTML/JS/CSS/画像/音声はユーザに渡っています。次の3層で対応します:

1. **法的根拠** (利用規約 / DMCA) — 損害賠償・削除請求の根拠を確立 ✅
2. **検出・追跡** (透かし / カナリア / 解析) — 海賊サイトを発見し出所追跡 ✅
3. **抑止** (UI制限 / ホスト検証 / DevTools検知) — 素人攻撃を排除 ✅

→ 本格的な保護は **作品本文をサーバAPIから動的配信**(認証付き)するしかありません。それは Phase B (#2+#3) で実施します。

---

## 実装済み機能 (`js/anti-piracy.js`)

### 1. ホスト検証
公式ホスト一覧外で動作した場合に画面上部に警告バナーを表示し、解析エンドポイント(将来的に)へ通報。

```js
officialHosts: [
  'nobkota2-lang.github.io',
  'aninovel.com',
  'www.aninovel.com',
  'aninovel.pages.dev',
  'localhost', '127.0.0.1'
]
```

→ ドメイン取得後 (#6) はここに本ドメインを追加。

### 2. 不可視透かし
ユーザID + タイムスタンプ + パス を **Zero-width 文字** で本文末尾にエンコードして埋込。
→ 海賊サイトに HTML がコピーされた場合、そのHTMLを取得して透かしを抽出すれば**いつ・誰がオリジナルを取得したか追跡可能**。

### 3. カナリアトークン
セッションごとにユニークIDを `<meta name="x-aninovel-canary">` として埋込。
→ 海賊サイトのHTMLにこのカナリアが残っていれば、出所セッションを特定可能。

### 4. UI 抑止 (任意設定)
- 右クリックメニュー無効化 (`blockRightClick`)
- コピー時に著作権警告テキストを差し込む (`blockCopy`)
- テキスト選択禁止 (`blockSelect`)

UX 影響大のため、**デフォルトは無効**。商用化フェーズで判断。

### 5. DevTools 検知
DevTools が開かれた時にコンソールに著作権警告メッセージを表示。
強制終了はしません(過剰反応・誤検知防止)。

---

## 設定変更

各HTMLの `<script src="js/anti-piracy.js">` の前に以下を入れる:

```html
<script>
window.ANINOVEL_ANTIPIRACY_CONFIG={
  blockRightClick: true,    // 右クリック禁止 (UX低下)
  blockCopy: true,          // コピー時に警告差込
  blockSelect: true,        // テキスト選択禁止 (UX低下大)
  detectDevTools: false,    // DevTools検知を無効化
  reportEndpoint: 'https://api.aninovel.com/report-piracy'
};
</script>
<script src="js/anti-piracy.js" defer></script>
```

---

## 海賊サイト発見時の対応フロー

1. **被害確認**: 海賊サイトのHTMLを取得し、Zero-width 透かし or カナリアの有無を確認
   ```js
   // ブラウザコンソールでHTMLから透かし抽出 (簡易):
   var html = document.body.innerHTML;
   var zw = html.match(/[​‌‍]+/g);
   // ZWNBSP/ZWJ の組合せをbinaryデコード
   ```
2. **証拠保全**: アーカイブサービス(archive.org)で当該ページを保存
3. **削除請求**:
   - ホスティング業者へDMCA通報 (Cloudflare/AWS/さくら等)
   - ドメインレジストラへ通報
   - 検索エンジンへ削除依頼 (Google: https://www.google.com/webmasters/tools/legal-removal-request)
4. **法的措置**: 悪質な場合は弁護士経由で内容証明・差止請求

---

## 将来の強化 (Phase B〜)

| 対策 | 効果 | 実装条件 |
|---|---|---|
| 作品本文をサーバから動的配信 | ★★★★★ | Supabase 移行(#2+#3)完了 |
| 認証必須化 + JWTで配信制限 | ★★★★ | 同上 |
| 段階配信(無料部分のみ静的、有料部分はサーバ) | ★★★★ | Stripe(#10)+認証連携 |
| 音声の署名付きURL(短期失効) | ★★★ | Supabase Storage |
| 画像のサーバ生成(キャラアイコンも動的) | ★★ | Edge Function 必要 |
| Bot 検知 (Cloudflare Bot Management) | ★★ | Pro プラン($25/月)以上 |
| HTMLの動的生成(SSR化) | ★★ | アーキテクチャ変更必要 |
| 難読化(JS minify+webpack obfuscate) | ★ | ビルドパイプライン必要 |

---

## やらないこと (推奨外)

- **完全な右クリック禁止 + テキスト選択禁止**: 真っ当な引用も妨げ、UX を著しく損なう。検索エンジン的にも不利
- **window.print 禁止**: アクセシビリティ侵害(視覚障害者の読み上げ機能を壊す)
- **過度な DevTools 検知 → ページ強制リロード**: 開発者・パワーユーザを敵に回す
- **重い JavaScript 難読化**: パフォーマンス低下、保守性低下、解析者には数分で解除される
