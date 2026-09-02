import { Hono } from 'hono';
import type { Env } from '../env';
import { requireUser } from '../utils/auth';
import {
  createCheckoutSession,
  createPortalSession,
  BillingError,
  BillingNotConfiguredError,
} from '../services/billingService';

const app = new Hono<{ Bindings: Env }>();

// POST /api/billing/checkout — start a Stripe Checkout subscription session.
app.post('/checkout', requireUser, async (c) => {
  const user = c.get('user');
  try {
    const result = await createCheckoutSession(c.env, {
      userId: user.id,
    });
    if (result.alreadyActive) {
      return c.json({ alreadyActive: true, url: null });
    }
    return c.json({ url: result.url });
  } catch (e) {
    if (e instanceof BillingNotConfiguredError) {
      return c.json({ error: 'BILLING_NOT_CONFIGURED' }, 503);
    }
    if (e instanceof BillingError) {
      return c.json({ error: e.message }, 400);
    }
    throw e;
  }
});

// POST /api/billing/portal — Stripe customer portal for self-serve management.
app.post('/portal', requireUser, async (c) => {
  const user = c.get('user');
  try {
    const result = await createPortalSession(c.env, { userId: user.id });
    return c.json(result);
  } catch (e) {
    if (e instanceof BillingNotConfiguredError) {
      return c.json({ error: 'BILLING_NOT_CONFIGURED' }, 503);
    }
    if (e instanceof BillingError) {
      return c.json({ error: e.message }, 400);
    }
    throw e;
  }
});

export default app;
