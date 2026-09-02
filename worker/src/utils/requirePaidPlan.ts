// AI Slide Config — Phase 1. Paid-plan gate for /api/events/:id/ai/* routes.
//
// Access is gated on the EVENT OWNER's plan (events.owner_id → users.plan_status),
// so co-admins on a paid owner's event get AI access too. This is the only
// place that decides who may call an AI route — the frontend hiding buttons is
// a UX nicety, never the actual gate.
//
// Entitlement (see billingService for the rules):
//   - 'active'                  → allowed
//   - 'past_due' / 'canceled'   → 402 (hard block)
//   - 'free'                    → allowed only if the one-presentation free
//                                 trial hasn't been consumed yet; consuming it
//                                 marks the owner's trial as used.
//   - super admin               → always allowed (platform operator)
//   - BILLING_BYPASS=1          → allowed (local dev only)
//
// Two gate flavors share the same owner/plan resolution:
//   - requirePaidPlan   — full gate; CONSUMES the free trial on first use.
//                         Used by AI actions that cost money (generate, revise).
//   - requireAiEntitled — checks the owner is entitled WITHOUT consuming the
//                         trial (reads/settings like GET/PUT ai context must
//                         not spend the one-presentation allowance).
//
// Decision (documented in ai_plan.md): cut AI access IMMEDIATELY on past_due —
// no grace period. Restore on the next successful charge.

import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { currentUser, type CurrentUser } from './auth';
import { getUser } from '../services/userService';
import { getEvent } from '../services/eventService';
import {
  isEntitled,
  isHardBlocked,
  consumeTrialIfNeeded,
} from '../services/billingService';
import type { User } from '../services/userService';

export interface PaidPlanUser extends CurrentUser {
  eventOwnerId: string;
  ownerPlan: User['planStatus'] | null;
  ownerTrialUsed: boolean;
}

export interface PaidPlanContext {
  Variables: {
    user: CurrentUser;
    aiOwner: PaidPlanUser;
    // Set when this request consumed the owner's one-presentation free trial.
    aiTrialConsumed: boolean;
  };
}

export type AiContext = { Bindings: Env; Variables: PaidPlanContext['Variables'] };

// Context structural type for the shared resolver below (works both inside and
// outside Hono middleware, mirroring utils/auth.ts's AnyContext pattern).
interface AnyContext {
  env: Env;
  req: { header: (name: string) => string | undefined; param: (name: string) => string | undefined };
}

/**
 * Shared front half of the AI gates: authenticate, load the event, resolve the
 * owner and their plan, and reject hard-blocked (past_due/canceled) owners.
 * Returns the resolved owner info; each middleware sets `user` on its own
 * typed context.
 */
async function resolveAiAccess(c: AnyContext): Promise<
  | { ok: false; response: { error: string; message?: string; upgradeUrl?: string }; status: 401 | 400 | 404 | 402 }
  | { ok: true; user: CurrentUser; owner: User | null; ownerIsSuper: boolean; ownerStatus: User['planStatus'] }
> {
  const user = await currentUser(c);
  if (!user) return { ok: false, response: { error: 'UNAUTHORIZED' }, status: 401 };

  const eventId = c.req.param('id');
  if (!eventId) return { ok: false, response: { error: 'EVENT_ID_REQUIRED' }, status: 400 };

  const event = await getEvent(c.env, eventId);
  if (!event) return { ok: false, response: { error: 'NOT_FOUND' }, status: 404 };

  const ownerId = event.ownerId ?? 'local-admin';
  const owner = await getUser(c.env, ownerId);
  const ownerIsSuper = owner?.isSuperAdmin ?? false;
  const ownerStatus = owner?.planStatus ?? 'free';

  if (!ownerIsSuper && isHardBlocked(ownerStatus)) {
    return {
      ok: false,
      response: {
        error: 'upgrade_required',
        message: 'This event needs an active plan for AI features.',
        upgradeUrl: '/billing',
      },
      status: 402,
    };
  }

  return { ok: true, user, owner, ownerIsSuper, ownerStatus };
}

function notEntitledResponse() {
  return {
    error: 'upgrade_required',
    message: 'AI features require an active plan.',
    upgradeUrl: '/billing',
  };
}

export const requirePaidPlan = createMiddleware<AiContext>(async (c, next) => {
  if (c.env.BILLING_BYPASS === '1') {
    // Local-dev convenience: bypass the plan gate (but not auth).
    const user = await currentUser(c);
    if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);
    c.set('user', user);
    c.set('aiOwner', {
      ...user,
      eventOwnerId: '',
      ownerPlan: 'active',
      ownerTrialUsed: false,
    });
    c.set('aiTrialConsumed', false);
    await next();
    return;
  }

  const access = await resolveAiAccess(c);
  if (!access.ok) return c.json(access.response, access.status);
  const { user, owner, ownerIsSuper, ownerStatus } = access;
  c.set('user', user);

  if (!ownerIsSuper) {
    const entitled = isEntitled(owner ?? {
      planStatus: ownerStatus,
      isSuperAdmin: false,
      trialPresentationUsedAt: null,
    });
    if (!entitled) return c.json(notEntitledResponse(), 402);
  }

  // Free-trial consumption: a free owner whose trial hasn't been used gets this
  // presentation's AI request on the house; the trial is marked used now.
  const trialConsumed = owner && !ownerIsSuper
    ? await consumeTrialIfNeeded(c.env, owner)
    : false;
  // consumeTrialIfNeeded returns true both when a trial was just consumed AND
  // when no trial consumption was needed (paid owner) — so only record it for
  // the actual free-trial case.
  const isFreeTrialOwner = ownerStatus === 'free' && !owner?.trialPresentationUsedAt;

  c.set('aiOwner', {
    ...user,
    eventOwnerId: owner?.id ?? 'local-admin',
    ownerPlan: ownerStatus,
    ownerTrialUsed: Boolean(owner?.trialPresentationUsedAt) || (isFreeTrialOwner && trialConsumed),
  });
  c.set('aiTrialConsumed', isFreeTrialOwner && trialConsumed);
  await next();
});

// Lighter gate for non-billing AI routes (GET/PUT context): same entitlement
// rules as requirePaidPlan (active / super / free-with-trial-available all
// pass) but the free trial is NOT consumed — saving a context string or opening
// the editor shouldn't spend the one-presentation allowance; the first actual
// generate call consumes it.
export const requireAiEntitled = createMiddleware<{ Bindings: Env; Variables: { user: CurrentUser } }>(async (c, next) => {
  if (c.env.BILLING_BYPASS === '1') {
    const user = await currentUser(c);
    if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);
    c.set('user', user);
    await next();
    return;
  }

  const access = await resolveAiAccess(c);
  if (!access.ok) return c.json(access.response, access.status);
  const { user, owner, ownerIsSuper, ownerStatus } = access;
  c.set('user', user);

  if (!ownerIsSuper) {
    const entitled = isEntitled(owner ?? {
      planStatus: ownerStatus,
      isSuperAdmin: false,
      trialPresentationUsedAt: null,
    });
    if (!entitled) return c.json(notEntitledResponse(), 402);
  }

  await next();
});
