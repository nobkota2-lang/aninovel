/**
 * アニノベル Stripe Customer Portal リダイレクト API
 * POST /api/billing/billing-portal
 *
 * フロント (js/billing.js openCustomerPortal) から呼ばれる:
 *   body: { customerId }  // Stripe Customer ID (cus_xxx)
 *   response: { url: 'https://billing.stripe.com/...' }
 *
 * 必要な環境変数:
 *   STRIPE_SECRET_KEY
 *   SITE_URL
 *
 * Stripeダッシュボード設定:
 *   https://dashboard.stripe.com/settings/billing/portal で
 *   - 機能(解約、プラン変更、領収書ダウンロード等)を有効化
 *   - ブランディングを設定
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'stripe_not_configured' }, 503);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid_json' }, 400); }

  const customerId = (body.customerId || '').toString();
  if (!customerId.startsWith('cus_')) {
    return json({ error: 'invalid_customer_id' }, 400);
  }

  const siteUrl = (env.SITE_URL || `https://${new URL(request.url).host}`).replace(/\/+$/, '');

  const params = new URLSearchParams();
  params.set('customer', customerId);
  params.set('return_url', `${siteUrl}/`);
  params.set('locale', 'ja');

  let stripeRes;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
      },
      body: params.toString(),
    });
  } catch (e) {
    return json({ error: 'stripe_unreachable' }, 502);
  }

  const data = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok) {
    console.error('[billing-portal] Stripe error:', stripeRes.status, data);
    return json({ error: 'stripe_error', message: (data.error && data.error.message) || 'エラー' }, 502);
  }

  return json({ url: data.url });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
