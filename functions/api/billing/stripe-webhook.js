/**
 * アニノベル Stripe Webhook 受信 API
 * POST /api/billing/stripe-webhook
 *
 * Stripeから契約状態の変更通知を受け取り、KVに保存する。
 *
 * 必要な環境変数:
 *   STRIPE_SECRET_KEY            sk_live_... または sk_test_...
 *   STRIPE_WEBHOOK_SECRET        whsec_...  (Webhook署名検証用)
 *
 * KV:
 *   BILLING_KV                   サブスク状態の永続化
 *
 * Stripeダッシュボード設定:
 *   https://dashboard.stripe.com/webhooks で
 *   - エンドポイントを追加: https://aninovel.com/api/billing/stripe-webhook
 *   - 監視するイベント:
 *     - checkout.session.completed
 *     - customer.subscription.created
 *     - customer.subscription.updated
 *     - customer.subscription.deleted
 *     - invoice.payment_succeeded
 *     - invoice.payment_failed
 *   - 表示される Signing secret を STRIPE_WEBHOOK_SECRET にセット
 *
 * 重要:
 *   Webhookは認証/レート制限の対象外 (Stripeから直接)。
 *   ただし署名検証が必須。失敗時は400を返す。
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response('not configured', { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });

  const rawBody = await request.text();

  // ===== 署名検証 =====
  const verified = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!verified) {
    console.warn('[webhook] signature verification failed');
    return new Response('invalid signature', { status: 400 });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch (e) { return new Response('invalid json', { status: 400 }); }

  console.info('[webhook] event:', event.type, event.id);

  // ===== イベント別ハンドリング =====
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object, env);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object, env);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object, env);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object, env);
        break;
      default:
        console.info('[webhook] unhandled event:', event.type);
    }
  } catch (e) {
    console.error('[webhook] handler error:', e);
    // 500を返すとStripeがリトライするので、エラー内容次第で判断。
    // データ問題なら200(処理済み扱い)、一時障害なら500(リトライしてほしい)。
    return new Response('handler error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}

// ===== Handlers =====

async function handleCheckoutCompleted(session, env) {
  const userId = session.client_reference_id || (session.metadata && session.metadata.user_id);
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  if (!userId || !customerId) return;

  if (env.BILLING_KV) {
    const data = {
      userId,
      customerId,
      subscriptionId,
      email: session.customer_email || (session.metadata && session.metadata.user_email),
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    await env.BILLING_KV.put(`user:${userId}`, JSON.stringify(data));
    await env.BILLING_KV.put(`cust:${customerId}`, userId);  // 逆引き
  }
  console.info('[webhook] checkout completed user=', userId);
}

async function handleSubscriptionUpdated(sub, env) {
  if (!env.BILLING_KV) return;
  const customerId = sub.customer;
  const userId = await env.BILLING_KV.get(`cust:${customerId}`);
  if (!userId) {
    console.warn('[webhook] user not found for customer:', customerId);
    return;
  }
  const prev = await env.BILLING_KV.get(`user:${userId}`);
  const data = prev ? JSON.parse(prev) : { userId, customerId };
  data.subscriptionId = sub.id;
  data.status = sub.status;   // active | trialing | past_due | canceled | unpaid
  data.currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
  data.cancelAtPeriodEnd = !!sub.cancel_at_period_end;
  // プラン判定 (Price IDをANINOVEL_STRIPE_PRICESに合わせて分類)
  const priceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
  data.priceId = priceId;
  data.plan = classifyPlan(priceId);
  data.updatedAt = new Date().toISOString();
  await env.BILLING_KV.put(`user:${userId}`, JSON.stringify(data));
}

async function handleSubscriptionDeleted(sub, env) {
  if (!env.BILLING_KV) return;
  const customerId = sub.customer;
  const userId = await env.BILLING_KV.get(`cust:${customerId}`);
  if (!userId) return;
  const prev = await env.BILLING_KV.get(`user:${userId}`);
  const data = prev ? JSON.parse(prev) : { userId, customerId };
  data.status = 'canceled';
  data.canceledAt = new Date().toISOString();
  data.plan = null;
  await env.BILLING_KV.put(`user:${userId}`, JSON.stringify(data));
}

async function handlePaymentFailed(invoice, env) {
  if (!env.BILLING_KV) return;
  // ユーザーに通知メールを送る等 (Stripeが自動再試行+メール送信もする)
  console.warn('[webhook] payment failed customer=', invoice.customer);
}

function classifyPlan(priceId) {
  if (!priceId) return null;
  // 環境変数 ANINOVEL_PRICE_MAP="price_xxx=reader-premium-monthly,price_yyy=author-pro-monthly"
  // 等で柔軟化も可だが、簡易にハードコードでも可
  return null;  // クライアント側で priceId から判定する場合は null のまま
}

// ===== Stripe署名検証 (Web Crypto API) =====

async function verifyStripeSignature(payload, signature, secret) {
  try {
    // Stripeの署名形式: t=1234567890,v1=abc...
    const parts = signature.split(',').reduce((acc, p) => {
      const [k, v] = p.split('=');
      acc[k] = v;
      return acc;
    }, {});
    const timestamp = parts.t;
    const expectedSig = parts.v1;
    if (!timestamp || !expectedSig) return false;

    // タイムスタンプチェック (5分以内)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      console.warn('[webhook] timestamp too old');
      return false;
    }

    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const actualSig = Array.from(new Uint8Array(sigBytes))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    // 定数時間比較
    return timingSafeEqual(expectedSig, actualSig);
  } catch (e) {
    console.error('[webhook] signature verify exception:', e);
    return false;
  }
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
