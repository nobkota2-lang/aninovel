# Stripe 課金システム導入計画

> 状態: 設計+クライアントスタブ済 (`js/billing.js`)
> 本格実装は Supabase Edge Functions (#3 Phase B) と同時並走

---

## 1. プラン設計

### 提案: 3プラン構成

| プラン | 月額 | 年額(2ヶ月分割引) | 対象 | 特典 |
|---|---|---|---|---|
| **Free** | ¥0 | - | 全ユーザ | 基本機能、広告あり、月3作品まで投稿 |
| **Reader Premium** | ¥480 | ¥4,800 | 読者 | 広告非表示、独自しおり無制限、優先機能アクセス |
| **Author Pro** | ¥980 | ¥9,800 | 作者 | 広告非表示、投稿無制限、収益還元(投稿PV連動)、解析ダッシュボード、優先サポート |

### 課金体系の根拠

- **¥480/月** はAdSenseで広告表示する場合の機会費用(月収益相当)を上回る価格設定
- **Author Pro** は収益還元込みで「自分の作品が読まれるほど稼げる」サイクルを作る
- 年額は2ヶ月分割引(約16%off)でロックイン促進

---

## 2. 必要なStripe設定

### 2-1. アカウント作成
1. https://dashboard.stripe.com/register でアカウント作成
2. 個人事業 or 法人を選択 → 本人確認(マイナンバー or 法人登記)
3. 銀行口座登録 (週次/月次入金)

### 2-2. 商品(Product)/価格(Price)作成
Stripeダッシュボード → "Products" → 以下を作成:

```
Product: Reader Premium
  Price 1: ¥480 / month  (recurring) → price_xxxxxxxxxxx_monthly
  Price 2: ¥4,800 / year (recurring) → price_xxxxxxxxxxx_yearly

Product: Author Pro
  Price 1: ¥980 / month  → price_yyyyyyyyy_monthly
  Price 2: ¥9,800 / year → price_yyyyyyyyy_yearly
```

### 2-3. Webhookエンドポイント設定
顧客の支払い状態変化を受信するため:

```
URL: https://api.aninovel.com/stripe/webhook (Supabase Edge Function)
イベント:
  - checkout.session.completed
  - customer.subscription.updated
  - customer.subscription.deleted
  - invoice.payment_failed
```

Webhook シークレット(`whsec_xxx`) は Edge Function の環境変数に設定。

---

## 3. アーキテクチャ

```
┌──────────┐  1. Checkout 開始要求           ┌─────────────────┐
│ ブラウザ │ ────────────────────────────→ │ Edge Function   │
│ (billing │                                  │ /create-checkout│
│   .js)   │ ←──────── 2. Stripe URL ──────  │                 │
└──────────┘                                  └─────────────────┘
     │                                                  │
     │ 3. Stripe Checkout へリダイレクト                │
     ↓                                                  │
┌──────────────┐                                        │
│ Stripe       │                                        │
│ checkout.session                                       │
│ (カード入力) │                                        │
└──────────────┘                                        │
     │                                                  │
     │ 4. 決済完了                                      │
     │ 5. Webhook 通知                                  ↓
     │                              ┌─────────────────────┐
     │                              │ Supabase            │
     │                              │ profiles.subscription│
     │                              │  = 'premium' に更新 │
     │                              └─────────────────────┘
     ↓ 6. アプリへ復帰
┌──────────┐
│ ブラウザ │  → 広告非表示が反映、機能解放
└──────────┘
```

**ポイント**: Stripe APIキーはサーバ側 (Edge Function) でのみ使用。クライアント側にはセッションIDのみ渡す。

---

## 4. クライアント実装 (`js/billing.js` 既配置)

```js
// 公開API
AninovelBilling.startCheckout('reader-premium-monthly');
AninovelBilling.openCustomerPortal();  // 解約・カード変更
AninovelBilling.getSubscription();      // 現在の契約状態
```

---

## 5. 必要なEdge Functions (Supabase)

### 5-1. `/create-checkout`
```typescript
// supabase/functions/create-checkout/index.ts (擬似コード)
import Stripe from 'stripe';
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

Deno.serve(async (req) => {
  const { priceId, userId, userEmail } = await req.json();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: userEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: 'https://aninovel.com/?checkout=success',
    cancel_url:  'https://aninovel.com/?checkout=cancel',
    metadata: { user_id: userId },
    locale: 'ja',
  });
  return new Response(JSON.stringify({ url: session.url }));
});
```

### 5-2. `/stripe-webhook`
```typescript
// 支払い状態を Supabase profiles に反映
Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature')!;
  const event = stripe.webhooks.constructEvent(
    await req.text(), sig, Deno.env.get('STRIPE_WEBHOOK_SECRET')!
  );
  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = event.data.object.metadata.user_id;
      const sub = event.data.object.subscription;
      // profiles.subscription = 'premium'/'author_pro' に更新
      await supabase.from('profiles').update({
        subscription: 'premium',
        stripe_customer_id: event.data.object.customer,
        stripe_subscription_id: sub
      }).eq('id', userId);
      break;
    }
    case 'customer.subscription.deleted': {
      const customerId = event.data.object.customer;
      await supabase.from('profiles').update({
        subscription: null
      }).eq('stripe_customer_id', customerId);
      break;
    }
  }
  return new Response('ok');
});
```

### 5-3. `/billing-portal`
```typescript
Deno.serve(async (req) => {
  const { customerId } = await req.json();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: 'https://aninovel.com/account',
  });
  return new Response(JSON.stringify({ url: session.url }));
});
```

---

## 6. 法務・税務対応

| 項目 | 対応 |
|---|---|
| **特定商取引法表記** | `legal/tokushoho.html` に契約条件・解約方法を明記 ✅ |
| **プライバシーポリシー** | Stripe を業務委託先として明記 ✅ |
| **利用規約** | 自動更新・返金不可・解約方法を記載 ✅ |
| **消費税** | Stripe側で内税表示設定。インボイス登録番号も連携可 |
| **クーリングオフ** | デジタルコンテンツは原則対象外、規約に明記 |
| **サブスク表記法** (2022年改正電取法) | 解約までの手順を明示、解約ボタンは「サブスク管理」内 |

---

## 7. 開発・テスト手順

1. Stripe **テストモード** でAPI key取得
2. テスト用カード番号 `4242 4242 4242 4242` で動作確認
3. Webhook は `stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook` でローカル受信
4. 本番モードに切替前に、特商法・税務処理を再確認

---

## 8. 段階的リリース計画

| Phase | 内容 | 前提 |
|---|---|---|
| **Pre-A** | クライアントスタブ実装 (billing.js) ✅ | - |
| **A** | Reader Premium のみ提供 | Supabase + ドメイン取得 |
| **B** | Author Pro 提供開始 | A の3ヶ月後、需要確認後 |
| **C** | 作者収益還元(#14)連動 | Author Pro一定数加入後 |
| **D** | 法人プラン・年間契約割引最適化 | データに基づき調整 |

---

## 9. 想定収益・損益分岐

### 損益分岐 (月)
- Supabase Pro: $25 ≒ ¥3,750
- ドメイン: $10/年 ≒ ¥125/月
- メール配信(Resend等): $0〜
- その他: ¥1,000(余裕枠)
- **固定費合計: ¥5,000/月**

### 必要有料会員数
- ¥5,000 ÷ ¥480 (Reader Premium) = **約11人で黒字化**
- 1万人MAU、有料転換率1% = 100人 = ¥48,000/月の純利
