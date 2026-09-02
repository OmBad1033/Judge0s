import type { Env } from '../env';
import { newId, now } from '../utils/common';

export interface User {
  id: string;
  googleSub: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  // AI Slide Config — Phase 0.
  planStatus: 'free' | 'active' | 'past_due' | 'canceled';
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  planUpdatedAt: string | null;
  trialPresentationUsedAt: string | null;
}

function mapUser(r: Record<string, unknown>): User {
  return {
    id: r.id as string,
    googleSub: r.google_sub as string,
    email: r.email as string,
    name: (r.name as string) ?? null,
    avatarUrl: (r.avatar_url as string) ?? null,
    isSuperAdmin: r.is_super_admin === 1 || r.is_super_admin === true,
    createdAt: r.created_at as string,
    lastLoginAt: (r.last_login_at as string) ?? null,
    planStatus: (r.plan_status as User['planStatus']) ?? 'free',
    stripeCustomerId: (r.stripe_customer_id as string) ?? null,
    stripeSubscriptionId: (r.stripe_subscription_id as string) ?? null,
    planUpdatedAt: (r.plan_updated_at as string) ?? null,
    trialPresentationUsedAt: (r.trial_presentation_used_at as string) ?? null,
  };
}

export function isSuperAdminEmail(email: string, env: Env): boolean {
  const allowlist = (env.SUPER_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowlist.length === 0) return false;
  return allowlist.includes(email.toLowerCase());
}

export async function upsertUserFromGoogle(
  env: Env,
  payload: { googleSub: string; email: string; name?: string; avatarUrl?: string },
): Promise<User> {
  const isSuper = isSuperAdminEmail(payload.email, env);
  const existing = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?')
    .bind(payload.googleSub)
    .first<{ id: string }>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE users SET email = ?, name = ?, avatar_url = ?, is_super_admin = ?, last_login_at = ? WHERE id = ?`,
    )
      .bind(
        payload.email,
        payload.name ?? null,
        payload.avatarUrl ?? null,
        isSuper ? 1 : 0,
        now(),
        existing.id,
      )
      .run();
    const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(existing.id).first();
    return mapUser(row!);
  }

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, avatar_url, is_super_admin, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      payload.googleSub,
      payload.email,
      payload.name ?? null,
      payload.avatarUrl ?? null,
      isSuper ? 1 : 0,
      now(),
      now(),
    )
    .run();
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return mapUser(row!);
}

export async function getUser(env: Env, id: string): Promise<User | null> {
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return row ? mapUser(row) : null;
}

export async function listEventAdmins(env: Env, eventId: string): Promise<{ user: User; role: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.*, ea.role AS role
     FROM event_admins ea
     JOIN users u ON u.id = ea.user_id
     WHERE ea.event_id = ?
     ORDER BY ea.created_at`,
  )
    .bind(eventId)
    .all();
  return (results as Record<string, unknown>[]).map((r) => ({
    user: mapUser(r),
    role: r.role as string,
  }));
}

export async function inviteEventAdmin(
  env: Env,
  eventId: string,
  email: string,
  invitedByUserId: string,
): Promise<{ user: User; role: string }> {
  const normalized = email.toLowerCase();
  const userRow = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(normalized)
    .first();
  if (!userRow) throw new UserNotFoundError(normalized);
  const user = mapUser(userRow);

  await env.DB.prepare(
    `INSERT INTO event_admins (event_id, user_id, role, invited_by, created_at)
     VALUES (?, ?, 'admin', ?, ?)
     ON CONFLICT(event_id, user_id) DO NOTHING`,
  )
    .bind(eventId, user.id, invitedByUserId, now())
    .run();

  return { user, role: 'admin' };
}

export async function removeEventAdmin(env: Env, eventId: string, userId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    'DELETE FROM event_admins WHERE event_id = ? AND user_id = ?',
  )
    .bind(eventId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function userIsEventAdmin(env: Env, userId: string, eventId: string): Promise<boolean> {
  const user = await getUser(env, userId);
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM event_admins WHERE event_id = ? AND user_id = ?',
  )
    .bind(eventId, userId)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

export class UserNotFoundError extends Error {
  constructor(email: string) {
    super(`User with email ${email} has not logged in yet. They must sign in once before they can be invited.`);
    this.name = 'UserNotFoundError';
  }
}

// AI Slide Config — Phase 0. Update the plan/billing fields on a user,
// returning the refreshed user row (or null if the user doesn't exist).
export async function updateUserPlan(
  env: Env,
  userId: string,
  patch: {
    planStatus?: User['planStatus'];
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    trialPresentationUsedAt?: string | null;
  },
): Promise<User | null> {
  const existing = await getUser(env, userId);
  if (!existing) return null;
  await env.DB.prepare(
    `UPDATE users SET
       plan_status = ?,
       stripe_customer_id = ?,
       stripe_subscription_id = ?,
       trial_presentation_used_at = ?,
       plan_updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      patch.planStatus ?? existing.planStatus,
      patch.stripeCustomerId !== undefined ? patch.stripeCustomerId : existing.stripeCustomerId,
      patch.stripeSubscriptionId !== undefined ? patch.stripeSubscriptionId : existing.stripeSubscriptionId,
      patch.trialPresentationUsedAt !== undefined ? patch.trialPresentationUsedAt : existing.trialPresentationUsedAt,
      now(),
      userId,
    )
    .run();
  return getUser(env, userId);
}

// AI Slide Config — Phase 0. Consume the owner's one-presentation free trial
// if it hasn't been used yet. Returns true when this call consumed it (i.e.
// the caller's AI request may proceed), false when it was already used.
export async function consumeFreeTrial(env: Env, userId: string): Promise<boolean> {
  const existing = await getUser(env, userId);
  if (!existing) return false;
  if (existing.trialPresentationUsedAt) return false;
  const result = await env.DB.prepare(
    `UPDATE users SET trial_presentation_used_at = ? WHERE id = ? AND trial_presentation_used_at IS NULL`,
  )
    .bind(now(), userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}