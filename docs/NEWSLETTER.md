# メールマガジン・通知基盤 設計

> 状態: 設計+購読フォーム実装済 (`js/newsletter.js`)
> 配信は外部 SaaS 利用 (Resend / SendGrid / ConvertKit)

---

## 1. 目的

- **新着作品の通知** → 再訪率向上
- **作者への投票・投げ銭通知** → エンゲージメント向上
- **マーケ・お知らせ配信** → サービス認知度向上、解約率低下

---

## 2. 配信サービス選定

| サービス | 無料枠 | 料金 | 推奨度 | 備考 |
|---|---|---|---|---|
| **Resend** | 3,000通/月 | $20で50,000通 | ★★★★★ | 開発者向け、API特化、シンプル |
| SendGrid | 100通/日 | $20で40,000通 | ★★★★ | 老舗、機能豊富、設定複雑 |
| Mailchimp | 500人/月 | $13で500人 | ★★★ | 高機能だが価格高い |
| ConvertKit | 1,000人 | $25で1,000人 | ★★★ | クリエイター向け |
| AWS SES | 62,000通/月(EC2上) | $0.10/1000通 | ★★ | 安いが運用必要 |

→ **Resend 推奨** (無料枠十分、JSON API シンプル、SPF/DKIM/DMARC 対応容易)

---

## 3. 必要な配信種別

| 種別 | トリガー | 受信者 | 必須/任意 |
|---|---|---|---|
| 仮登録メール | 新規登録 | 本人 | 必須 (システム) |
| パスワードリセット | リセット要求 | 本人 | 必須 (システム) |
| 決済完了通知 | Stripe checkout | 本人 | 必須 (法務) |
| 投票通知 | 自作品が投票された | 作者 | 任意 |
| 投げ銭通知 | 投げ銭を受けた | 作者 | 任意 |
| コメント通知 | コメント受信 | 作者 | 任意 |
| 新着作品ダイジェスト | 週次配信 | 購読者 | オプトイン |
| お知らせ | 都度 | 全員 | オプトアウト可 |

---

## 4. ドメイン設定 (重要)

メールが迷惑メール扱いされないため:

```dns
TYPE  NAME                    VALUE
MX    aninovel.com           feedback-smtp.us-east-1.amazonses.com (priority 10)
TXT   aninovel.com           "v=spf1 include:resend.com -all"
TXT   resend._domainkey      "p=MIGfMA0G..." (Resend が発行)
TXT   _dmarc.aninovel.com    "v=DMARC1; p=quarantine; rua=mailto:postmaster@aninovel.com"
```

→ Resend / SendGrid のダッシュボードで自動生成された値をDNSに追加。

---

## 5. データモデル

```sql
CREATE TABLE newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id),  -- 登録ユーザの場合
  status TEXT DEFAULT 'pending',  -- pending/confirmed/unsubscribed/bounced
  confirmed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  source TEXT,                    -- 'footer'/'modal'/'signup'
  preferences JSONB,              -- {weekly:true, comments:true, votes:false, ...}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email TEXT,
  type TEXT,                      -- 'signup_confirm'/'password_reset'/'newsletter_weekly'/...
  subject TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivery_status TEXT,           -- 'sent'/'delivered'/'bounced'/'complained'
  error TEXT
);
```

---

## 6. ダブルオプトイン (推奨)

特定電子メール法準拠:

```
1. ユーザがフォームにメール入力
2. confirmation_token を生成、DB に status='pending' で保存
3. 確認メール送信「下記URLで購読を確定してください」
4. ユーザがURLクリック → status='confirmed' に変更
5. 以降、配信対象に追加
```

→ 確認しないユーザは配信されない=苦情リスク低下、配信成績(deliverability)向上。

---

## 7. 配信頻度 (推奨)

- **週次ダイジェスト** (毎週金曜18時) - 主力配信
  - 今週の新着Top5、ランキング上昇作品、編集部おすすめ1作品
- **月次まとめ** (月初) - 統計と運営報告
- **イベント駆動** - 投票/投げ銭/コメント受信時 (作者宛、即時)
- **緊急** - 障害情報、セキュリティ事故時 (年数回程度)

→ 週1回より多いと解約率が跳ね上がる(業界平均: 月1-2回が最適)。

---

## 8. クライアント実装 (`js/newsletter.js` 既配置)

```js
// 公開API
AninovelNewsletter.openSubscribeModal();  // モーダル表示
AninovelNewsletter.subscribe(email, prefs); // 直接購読
AninovelNewsletter.unsubscribe(token);    // 解除
```

---

## 9. 解約・配信停止

- 全メールに `List-Unsubscribe` ヘッダ + `mailto:` を含める (Gmail要件)
- 本文末尾に「配信停止」リンク (1クリックで解除可、再認証不要)
- 解除後30日間は再購読時に確認メール送信、悪意のある連投を防止

---

## 10. 法的留意

- **特電法**: ダブルオプトイン必須、解除明示、送信者表記必須
- **GDPR (EU住所)**: 明示同意、購読プリチェック禁止
- **CAN-SPAM (米)**: 物理住所表記、解除1営業日以内対応
- **個人情報保護法**: メールアドレスは個人情報、安全管理措置必須

→ 当面は日本国内向けに限定運用、海外展開時に追加対応。
