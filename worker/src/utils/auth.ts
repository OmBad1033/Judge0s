import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Env } from '../env';
import { hmacSign, hmacVerify, strToB64url, b64urlToStr } from './common';

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

export const adminGuard = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  // Production: Cloudflare Access injects this assertion header at the edge.
  if (c.req.header('Cf-Access-Jwt-Assertion')) {
    // TODO: verify signature via Access JWKS when CF_ACCESS_TEAM_DOMAIN is configured.
    await next();
    return;
  }

  // Local dev: signed session cookie fallback.
  const token = getCookie(c, 'admin_token');
  const payload = token ? await verifyToken(token, c.env.SESSION_SECRET) : null;
  if (!payload) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }
  await next();
});
