import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { hmacSign, hmacVerify, strToB64url, b64urlToStr } from './common';
import { verifyUserJwt, type UserJwtPayload } from '../services/jwtService';
import { getUser, userIsEventAdmin } from '../services/userService';

// Hono's Context type is invariant over Variables; we use a structural shape
// so the helpers work from both inside and outside middleware. We read cookies
// from the raw Cookie header instead of hono/cookie's getCookie so we don't
// have to import the full Hono Context type here.
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

// ===== Legacy password-cookie admin path (Phase 0) =====

export interface AdminPayload {
  role: 'admin';
  exp: number;
}

export async function signToken(payload: AdminPayload, secret: string): Promise<string> {
  const message = JSON.stringify(payload);
  const sig = await hmacSign(secret, message);
  return `${strToB64url(message)}.${sig}`;
}

export async function verifyToken(token: string, secret: string): Promise<AdminPayload | null> {
  const [enc, sig] = token.split('.');
  if (!enc || !sig) return null;
  const message = b64urlToStr(enc);
  if (!(await hmacVerify(secret, message, sig))) return null;
  try {
    const payload = JSON.parse(message) as AdminPayload;
    if (payload.role !== 'admin' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Production: Cloudflare Access injects this assertion header at the edge.
export const adminGuard = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (c.req.header('Cf-Access-Jwt-Assertion')) {
    // TODO: verify signature via Access JWKS when CF_ACCESS_TEAM_DOMAIN is configured.
    await next();
    return;
  }

  // Accepts either legacy admin cookie or Google OAuth user JWT.
  const u = await currentUser(c);
  if (!u) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }
  await next();
});

// ===== Phase 1 — Google OAuth + user JWTs =====

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  authMethod: 'google_jwt' | 'legacy_admin_cookie';
};

async function userFromGoogleJwt(env: Env, authHeader: string | undefined, cookieToken: string | undefined): Promise<CurrentUser | null> {
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearer ?? cookieToken;
  if (!token) return null;
  const payload: UserJwtPayload | null = await verifyUserJwt(token, env.JWT_SECRET);
  if (!payload) return null;
  const user = await getUser(env, payload.sub);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin,
    authMethod: 'google_jwt',
  };
}

async function userFromLegacyCookie(env: Env, token: string | undefined): Promise<CurrentUser | null> {
  if (!token) return null;
  const p = await verifyToken(token, env.SESSION_SECRET);
  if (!p) return null;
  return {
    id: 'local-admin',
    email: 'admin@local',
    name: 'Local Admin',
    avatarUrl: null,
    isSuperAdmin: true,
    authMethod: 'legacy_admin_cookie',
  };
}

interface AnyContext {
  env: Env;
  req: { header: (name: string) => string | undefined };
}

export async function currentUser(c: AnyContext): Promise<CurrentUser | null> {
  const authHeader = c.req.header('Authorization');
  const cookieHeader = c.req.header('Cookie');
  const userCookie = readCookie(cookieHeader, 'user_token');
  const adminCookie = readCookie(cookieHeader, 'admin_token');
  return resolveCurrentUser(c.env, authHeader, userCookie, adminCookie);
}

export async function resolveCurrentUser(
  env: Env,
  authHeader: string | undefined,
  userCookie: string | undefined,
  adminCookie: string | undefined,
): Promise<CurrentUser | null> {
  const u = await userFromGoogleJwt(env, authHeader, userCookie);
  if (u) return u;
  return userFromLegacyCookie(env, adminCookie);
}

export const requireUser = createMiddleware<{ Bindings: Env; Variables: { user: CurrentUser } }>(async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);
  c.set('user', user);
  await next();
});

export const requireEventAdmin = (eventIdParam: string = 'id') =>
  createMiddleware<{ Bindings: Env; Variables: { user: CurrentUser } }>(async (c, next) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);
    const eventId = c.req.param(eventIdParam);
    if (!eventId) return c.json({ error: 'EVENT_ID_REQUIRED' }, 400);
    const ok = await userIsEventAdmin(c.env, user.id, eventId);
    if (!ok) return c.json({ error: 'FORBIDDEN' }, 403);
    c.set('user', user);
    await next();
  });