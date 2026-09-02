import { Hono } from 'hono';
import type { Env } from '../../env';
import { applyStripeEvent, isBillingConfigured, type StripeWebhookEvent } from '../../services/billingService';

// Phase 0 — Stripe webhook. MUST bypass any JSON body-parsing middleware:
// Stripe signature verification needs the raw request body. Mount this router
// in index.ts BEFORE any global app.use(jsonParser) (there is none today, but
// the ordering constraint is documented so it stays safe).
const app = new Hono<{ Bindings: Env }>();

export async function verifyStripeSignature(
  env: Env,
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<boolean> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  // Stripe sends `t=timestamp,v1=signature`. We recompute an HMAC over
  // `${timestamp}.${rawBody}` with the webhook secret and compare to v1.
  const parts = signatureHeader.split(',');
  const ts = parts.find((p) => p.startsWith('t='))?.slice(2);
  const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
  if (!ts || !v1) return false;

  // Reject signatures older than 5 minutes (basic replay protection).
  const ageSec = Math.floor(Date.now() / 1000) - Number(ts);
  if (!Number.isFinite(ageSec) || ageSec < -300 || ageSec > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${ts}.${rawBody}`),
  );
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const actual = v1.toLowerCase();
  if (expected.length !== actual.length) return false;
  // Constant-time-ish comparison (no crypto.timingSafeEqual in Workers).
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

app.post('/', async (c) => {
  if (!isBillingConfigured(c.env)) {
    return c.json({ error: 'BILLING_NOT_CONFIGURED' }, 503);
  }
  const rawBody = await c.req.text();
  const signature = c.req.header('Stripe-Signature');
  const ok = await verifyStripeSignature(c.env, rawBody, signature);
  if (!ok) return c.json({ error: 'INVALID_SIGNATURE' }, 400);

  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent;
  } catch {
    return c.json({ error: 'INVALID_JSON' }, 400);
  }

  const result = await applyStripeEvent(c.env, event);
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ received: true, action: result.action });
});

export default app;
