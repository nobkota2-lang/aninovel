# 監視・負荷試験 設計

> 状態: クライアント側エラー監視実装済 (`js/error-monitor.js`)
> 各SaaSはユーザのアカウント開設後に有効化

---

## 1. 監視の3層

| 層 | ツール | 目的 | 費用 |
|---|---|---|---|
| **エラー (RUM)** | Sentry | JSランタイムエラー、APIエラー | Free 5k events/月 / Team $26/月 |
| **死活監視** | UptimeRobot | サイトダウン即時通知 | Free 50ヶ所5分間隔 |
| **パフォーマンス** | Lighthouse CI | LCP, CLS, FID, SEO | 無料 (GitHub Actions) |
| **ログ (Backend)** | Supabase ログ | DB/Edge Function実行ログ | Pro $25/月で30日保存 |
| **トラフィック異常** | Cloudflare Analytics | 不正アクセス、Bot検知 | Free |

---

## 2. Sentry セットアップ

1. https://sentry.io/ アカウント作成 (個人なら Free プラン可)
2. 「Project」作成 → Platform: JavaScript → 名前 `aninovel`
3. 表示される **DSN** (https://xxx@sentry.io/yyy) をコピー
4. 各HTMLに埋込:
   ```html
   <script>
     window.ANINOVEL_SENTRY_DSN='https://xxx@sentry.io/yyy';
     window.ANINOVEL_ERROR_SAMPLE=0.1; // 本番は10%サンプリング
   </script>
   <script src="js/error-monitor.js" defer></script>
   ```
5. 動作確認: ブラウザコンソールで `window.AninovelMonitor.capture('error', new Error('test'))` 実行 → Sentry ダッシュボードに表示

### 2-1. アラート設定 (推奨)

| 条件 | 通知先 |
|---|---|
| 1時間で同種エラー10件以上 | Slack/メール |
| 新規エラー(初出) | Slack |
| エラー率>1% | メール |
| 重大度=fatal | 即時メール+SMS |

---

## 3. UptimeRobot セットアップ

1. https://uptimerobot.com/ アカウント作成
2. "Add New Monitor" → 以下を登録:

| URL | チェック種別 | 間隔 |
|---|---|---|
| `https://aninovel.com/` | HTTPS(2xx) | 5分 |
| `https://aninovel.com/sitemap.xml` | HTTPS+content match | 5分 |
| `https://api.aninovel.com/health` | HTTPS | 5分 |
| `https://aninovel.com/data/catalog.json` | HTTPS+keyword "works" | 5分 |

3. 通知設定: メール/Slack/Discord/Telegram (無料5チャネル)

---

## 4. Lighthouse CI (GitHub Actions)

`.github/workflows/lighthouse.yml`:

```yaml
name: Lighthouse CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: treosh/lighthouse-ci-action@v11
        with:
          urls: |
            https://nobkota2-lang.github.io/aninovel/
            https://nobkota2-lang.github.io/aninovel/manual.html
          uploadArtifacts: true
          temporaryPublicStorage: true
      - name: コアウェブバイタル品質ゲート
        run: |
          # PR時は CI が失敗 → マージ阻止
          # 本番デプロイ後はレポートのみ
```

### 4-1. 品質目標

| 指標 | 目標 | 説明 |
|---|---|---|
| Performance | 90+ | 総合パフォーマンス |
| LCP (Largest Contentful Paint) | <2.5s | メインコンテンツ表示時間 |
| CLS (Cumulative Layout Shift) | <0.1 | レイアウトずれ |
| FID/INP | <200ms | 操作応答性 |
| Accessibility | 95+ | アクセシビリティ |
| SEO | 100 | SEO最適化 |
| Best Practices | 95+ | セキュリティ・モダンプラクティス |

---

## 5. 負荷試験

### 5-1. ツール

- **k6** (https://k6.io/) - 軽量CLI、JSスクリプト、推奨
- **Locust** - Python製、UI管理画面
- **Apache JMeter** - 老舗、機能豊富

### 5-2. シナリオ例 (k6)

`tests/load/basic.js`:
```js
import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 100 },  // 100同時接続まで上昇
    { duration: '3m', target: 100 },  // 維持
    { duration: '1m', target: 500 },  // ピーク
    { duration: '2m', target: 0 },    // 終了
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'], // 95%が500ms以下
    'http_req_failed':   ['rate<0.01'], // エラー率1%未満
  },
};

const BASE = __ENV.BASE_URL || 'https://aninovel.com';

export default function () {
  // トップページ
  const r1 = http.get(`${BASE}/`);
  check(r1, { 'top 200': (r) => r.status === 200 });
  sleep(2);
  // 作品ビューワ
  const r2 = http.get(`${BASE}/viewer.html?work=mystery-garden`);
  check(r2, { 'viewer 200': (r) => r.status === 200 });
  sleep(5);
  // 音声ファイル
  const r3 = http.get(`${BASE}/data/audio/mystery-garden/c1.wav`);
  check(r3, { 'audio 200': (r) => r.status === 200 });
  sleep(3);
}
```

実行:
```bash
k6 run tests/load/basic.js
k6 run -e BASE_URL=https://staging.aninovel.com tests/load/basic.js
```

### 5-3. 負荷試験のタイミング

- **Phase B 完了直後** (バックエンド稼働開始) — 100同接で安定動作確認
- **本番リリース1ヶ月後** — 実トラフィックパターンに基づき再試験
- **大型アップデート前** — Regression防止
- **キャンペーン前** — 想定3倍負荷で耐久確認

---

## 6. ログ集約 (将来)

### Supabase + Logflare (Phase B以降)

- Supabase はデフォで Postgres ログを記録
- Edge Function ログは Logflare で長期保存可
- BigQuery / Datadog 連携も可能

### 自前ログ (Cloudflare Workers Analytics Engine)

- Workers が稼働すれば Analytics Engine に書き込み可
- $0.25/百万リクエスト + $0.10/M ストレージ
- アクセスログ・カスタムイベントを集約

---

## 7. インシデント対応プロセス

```
0. 検知 (Sentry/UptimeRobot/ユーザ通報)
       ↓
1. 一次対応 (5分以内)
   - 影響範囲の確認
   - 障害ステータスページ更新 (cloudflare statuspage 等)
       ↓
2. 暫定対応 (30分以内)
   - 機能無効化、フォールバック切替
       ↓
3. 本格対応 (24時間以内)
   - 修正実装、テスト
       ↓
4. 事後対応
   - インシデントレポート作成
   - 再発防止策のIssue化
```

---

## 8. 本サービスでの優先順位

### 必須(Phase A〜B)
- [ ] Sentry エラー監視 (サンプリング10%)
- [ ] UptimeRobot 死活監視 (5分間隔)
- [ ] Lighthouse CI (PR毎)

### 推奨(Phase C以降)
- [ ] k6 負荷試験 (リリース前)
- [ ] ステータスページ公開 (Cloudflare Pages の Statuspage)
- [ ] アラート連携 (Slack/Discord)

### 将来(Phase D以降)
- [ ] APM(Application Performance Monitoring) — Datadog 等
- [ ] エラーバジェット運用 (SRE的)
