// AI Slide Config — Phase 0. Stripe billing: Checkout session creation, the
// customer portal, and webhook event application. Plan gating itself lives in
// `utils/requirePaidPlan.ts` (Phase 1) and calls `isEntitled`/`consumeTrialIfNeeded`
// below — everything about *who is allowed* is kept in this one service so the
// gate middleware stays a thin shell.

import type { Env } from '../env';
import { newId, now } from '../utils/common';
import { getUser, updateUserPlan, consumeFreeTrial } from './userService';
import type { User } from './userService';

const STRIPE_API = 'https://api.stripe.com/v1';

const SUBSCRIPTION_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingError';
  }
}

export class BillingNotConfiguredError extends BillingError {
  constructor() {
    super('STRIPE_SECRET_KEY is not configured');
    this.name = 'BillingNotConfiguredError';
  }
}

export function isBillingConfigured(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

function secretKey(env: Env): string {
  if (!env.STRIPE_SECRET_KEY) throw new BillingNotConfiguredError();
  return env.STRIPE_SECRET_KEY;
}

// Resolve the real user behind a request, treating the legacy local admin
// cookie exactly like the rest of the codebase does (utils/auth).
async function resolveBillableUser(env: Env, auth: { userId?: string; authHeader?: string; userCookie?: string; adminCookie?: string }): Promise<User | null> {
  if (auth.userId) return getUser(env, auth.userId);
  if (auth.authHeader) {
    const { resolveCurrentUser } = await import('../utils/auth');
    const u = await resolveCurrentUser(env, auth.authHeader, auth.userCookie, auth.adminCookie);
    return u ? getUser(env, u.id) : null;
  }
  return null;
}

export interface CreateCheckoutResult {
  url: string;
  alreadyActive?: boolean;
  error?: string;
}

// POST /api/billing/checkout — create a Stripe Checkout session for the
// calling user. Idempotent-ish: if they already hold an active subscription
// we return `alreadyActive` instead of minting a second Checkout session.
export async function createCheckoutSession(env: Env, auth: { userId?: string; authHeader?: string; userCookie?: string; adminCookie?: string }): Promise<CreateCheckoutResult> {
  const key = secretKey(env);
  const user = await resolveBillableUser(env, auth);
  if (!user) throw new BillingError('UNAUTHORIZED');
  if (user.planStatus === 'active') {
    return { url: '', alreadyActive: true };
  }

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const res = await fetch(`${STRIPE_API}/customers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: user.email,
        name: user.name ?? '',
        'metadata[userId]': user.id,
      }),
    });
    if (!res.ok) throw new BillingError(`Stripe customer creation failed: ${res.status} ${await res.text()}`);
    const customer = (await res.json()) as { id: string };
    customerId = customer.id;
    await updateUserPlan(env, user.id, { stripeCustomerId: customerId });
  }

  const priceId = env.STRIPE_PRICE_ID;
  const successUrl = 'https://app.example.com/billing/success?session_id={CHECKOUT_SESSION_ID}';
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId ?? '',
      'line_items[0][quantity]': '1',
      'subscription_data[metadata][userId]': user.id,
      success_url: successUrl,
      cancel_url: 'https://app.example.com/billing/cancel',
      client_reference_id: user.id,
    }),
  });
  if (!res.ok) throw new BillingError(`Stripe checkout creation failed: ${res.status} ${await res.text()}`);
  const session = (await res.json()) as { url?: string; id: string };
  if (!session.url) throw new BillingError('Stripe returned no Checkout URL');
  return { url: session.url };
}

export interface CreatePortalResult {
  url: string;
  error?: string;
}

// POST /api/billing/portal — Stripe customer portal (self-serve cancel /
// downgrade / update payment method). The plan gates on past_due, not here.
export async function createPortalSession(env: Env, auth: { userId?: string; authHeader?: string; userCookie?: string; adminCookie?: string }): Promise<CreatePortalResult> {
  const key = secretKey(env);
  const user = await resolveBillableUser(env, auth);
  if (!user) throw new BillingError('UNAUTHORIZED');
  if (!user.stripeCustomerId) throw new BillingError('NO_CUSTOMER');
  const res = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      customer: user.stripeCustomerId,
      return_url: 'https://app.example.com/billing',
    }),
  });
  if (!res.ok) throw new BillingError(`Stripe portal creation failed: ${res.status} ${await res.text()}`);
  const session = (await res.json()) as { url: string };
  return { url: session.url };
}

export type StripeEventType =
  | 'checkout.session.completed'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted';

export interface StripeWebhookEvent {
  id: string;
  type: StripeEventType;
  data: {
    object: {
      id?: string;
      customer?: string | null;
      status?: string;
      client_reference_id?: string | null;
      metadata?: Record<string, string> | null;
      cancel_at_period_end?: boolean;
    };
  };
}

export async function getStripeEventUserId(env: Env, ev: StripeWebhookEvent): Promise<string | null> {
  const obj = ev.data?.object ?? {};
  // checkout.session.completed carries client_reference_id (and the customer
  // id); subscription events carry metadata.userId on the subscription object.
  const userId = obj.metadata?.userId ?? obj.client_reference_id ?? null;
  if (userId) return userId;
  // Fall back to customer email → users.email lookup.
  if (obj.customer) {
    const key = secretKey(env);
    const res = await fetch(`${STRIPE_API}/customers/${obj.customer}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      const customer = (await res.json()) as { email?: string };
      if (customer.email) {
        const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
          .bind(customer.email)
          .first<{ id: string }>();
        if (row) return row.id;
      }
    }
  }
  return null;
}

// Map a Stripe subscription status to our plan_status.
function planStatusForSubscriptionStatus(status: string | undefined): User['planStatus'] {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'incomplete':
    case 'paused':
    default:
      return 'free';
  }
}

export type ApplyStripeEventResult =
  | { ok: true; action: string; userId?: string }
  | { ok: false; error: string };

// Apply one webhook event. Idempotent via billing_events.stripe_event_id —
// Stripe retries on timeout and replaying the same event must not double-apply.
export async function applyStripeEvent(env: Env, ev: StripeWebhookEvent): Promise<ApplyStripeEventResult> {
  if (!SUBSCRIPTION_EVENTS.has(ev.type)) {
    // Not a plan-affecting event — record nothing, treat as handled.
    return { ok: true, action: 'ignored' };
  }
  if (!ev.id) return { ok: false, error: 'MISSING_EVENT_ID' };

  const already = await env.DB.prepare('SELECT 1 AS ok FROM billing_events WHERE stripe_event_id = ?')
    .bind(ev.id)
    .first<{ ok: number }>();
  if (already) return { ok: true, action: 'duplicate' };

  const userId = await getStripeEventUserId(env, ev);
  if (!userId) return { ok: false, error: 'UNKNOWN_USER' };

  const obj = ev.data?.object ?? {};
  let action = 'applied';

  switch (ev.type) {
    case 'checkout.session.completed': {
      // Subscription just created — flip the user to their subscription state.
      await updateUserPlan(env, userId, {
        planStatus: 'active',
        stripeCustomerId: obj.customer ?? null,
        stripeSubscriptionId: obj.id ?? null,
      });
      action = 'activated';
      break;
    }
    case 'customer.subscription.updated': {
      await updateUserPlan(env, userId, {
        planStatus: planStatusForSubscriptionStatus(obj.status),
        stripeSubscriptionId: obj.id ?? null,
      });
      action = `status:${obj.status ?? 'unknown'}`;
      break;
    }
    case 'customer.subscription.deleted': {
      await updateUserPlan(env, userId, {
        planStatus: 'free',
        stripeSubscriptionId: null,
      });
      action = 'deactivated';
      break;
    }
  }

  await env.DB.prepare(
    `INSERT INTO billing_events (id, user_id, stripe_event_id, type, raw_json, processed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId(), userId, ev.id, ev.type, JSON.stringify(ev), now())
    .run();

  return { ok: true, action, userId };
}

// ===== Entitlement helpers (shared with utils/requirePaidPlan.ts) =====

// Is this user entitled to AI features? True for: active plans, super admins
// (they administer the platform), and free users who haven't yet consumed the
// one-presentation trial. past_due/canceled users are NOT entitled — they've
// exhausted both the trial (they used it to get here) and their paid access.
export function isEntitled(user: Pick<User, 'planStatus' | 'isSuperAdmin' | 'trialPresentationUsedAt'>): boolean {
  if (user.isSuperAdmin) return true;
  if (user.planStatus === 'active') return true;
  if (user.planStatus === 'free' && !user.trialPresentationUsedAt) return true;
  return false;
}

// Owner entitlement: AI is gated on the event owner's plan, so the event's
// owner (or the legacy local-admin / a super admin acting on the event) is the
// user whose plan matters.
export function ownerIdForEvent(
  env: Env,
  event: { ownerId?: string },
): string {
  return event.ownerId ?? 'local-admin';
}

// Mark the trial as used when a free user consumes their one free presentation.
// Returns true if the request is allowed to proceed (trial was available and
// has now been consumed, or the user wasn't on the trial path at all).
export async function consumeTrialIfNeeded(env: Env, owner: User | null): Promise<boolean> {
  if (!owner) return false;
  if (owner.planStatus !== 'free' || owner.trialPresentationUsedAt) return true;
  return consumeFreeTrial(env, owner.id);
}

// Whether this status should hard-block new AI requests (the free trial is
// irrelevant for these — they represent a failed or canceled subscription).
export function isHardBlocked(status: User['planStatus']): boolean {
  return status === 'past_due' || status === 'canceled';
}
