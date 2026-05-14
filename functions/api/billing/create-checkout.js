/**
 * アニノベル Stripe Checkout 作成 API
 * POST /api/billing/create-checkout
 *
 * フロント (js/billing.js startCheckout) から呼ばれる:
 *   body: { priceId, userId, userEmail }
 *   response: { url: '...' } (Stripe Checkout URL)
 *
 * 必要な環境変数:
 *   STRIPE_SECRET_KEY        sk_live_... または sk_test_...
 *   SITE_URL                 https://aninovel.com
 *
 * Stripeダッシュボードでの事前準備:
 *   1. Products & Prices を作成:
 *      - Reader Premium (Monthly): price_xxx
 *      - Reader Premium (Yearly): price_xxx
 *      - Author Pro (Monthly): price_xxx
 *      - Author Pro (Yearly): price_xxx
 *   2. Customer Portal を有効化 (https://dashboard.stripe.com/test/settings/billing/portal)
 *   3. このAPIで生成したURLにリダイレクトされる
 *
 * フロント側設定 (HTML内):
 *   window.ANINOVEL_BILLING_API='/api/billing';
 *   window.ANINOVEL_STRIPE_PRICES={
 *     'reader-premium-monthly': 'price_xxx',
 *     'author-pro-monthly': 'price_yyy'
 *   };
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'stripe_not_configured', message: 'Stripe APIキーが設定されていません' }, 503);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid_json' }, 400); }

  const priceId = (body.priceId || '').toString();
  const userId = (body.userId || '').toString().slice(0, 64);
  const userEmail = (body.userEmail || '').toString().slice(0, 254);

  // Stripe Price IDは "price_" で始まる
  if (!priceId.startsWith('price_')) {
    return json({ error: 'invalid_price_id' }, 400);
  }
  if (!userEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(userEmail)) {
    return json({ error: 'invalid_email' }, 400);
  }

  const siteUrl = (env.SITE_URL || `https://${new URL(request.url).host}`).replace(/\/+$/, '');

  // ===== Stripe Checkout Session 作成 =====
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('payment_method_types[]', 'card');
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('customer_email', userEmail);
  params.set('client_reference_id', userId);
  params.set('success_url', `${siteUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${siteUrl}/?billing=cancel`);
  // 日本円・日本語対応
  params.set('locale', 'ja');
  // メタデータでユーザーを追跡
  params.set('metadata[user_id]', userId);
  params.set('metadata[user_email]', userEmail);
  params.set('subscription_data[metadata][user_id]', userId);
  // 自動税計算 (オプション、Stripeで税設定が必要)
  // params.set('automatic_tax[enabled]', 'true');
  // 領収書送信
  params.set('billing_address_collection', 'required');
  // 同意のチェックボックス (任意)
  params.set('consent_collection[terms_of_service]', 'required');
  params.set('custom_text[terms_of_service_acceptance][message]', `アニノベルの[利用規約](${siteUrl}/legal/terms.html)および[特商法表記](${siteUrl}/legal/tokushoho.html)に同意します`);

  let stripeRes;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
      },
      body: params.toString(),
    });
  } catch (e) {
    console.error('[create-checkout] Stripe unreachable:', e);
    return json({ error: 'stripe_unreachable' }, 502);
  }

  const data = await stripeRes.json().catch(() => ({}));

  if (!stripeRes.ok) {
    console.error('[create-checkout] Stripe error:', stripeRes.status, data);
    return json({
      error: 'stripe_error',
      message: (data && data.error && data.error.message) || 'Stripe APIエラー',
      status: stripeRes.status
    }, 502);
  }

  if (!data.url) {
    return json({ error: 'no_checkout_url' }, 502);
  }

  return json({ url: data.url, sessionId: data.id });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
