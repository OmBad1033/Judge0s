import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../env';
import { adminGuard, signToken } from '../utils/auth';

const app = new Hono<{ Bindings: Env }>();

const DAY_MS = 1000 * 60 * 60 * 24;

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }
  const token = await signToken({ role: 'admin', exp: Date.now() + DAY_MS }, c.env.SESSION_SECRET);
  setCookie(c, 'admin_token', token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24,
    secure: c.env.ENVIRONMENT === 'production',
  });
  return c.json({ ok: true });
});

app.post('/logout', (c) => {
  deleteCookie(c, 'admin_token', { path: '/' });
  return c.json({ ok: true });
});

app.get('/me', adminGuard, (c) => c.json({ ok: true, role: 'admin' }));

export default app;
