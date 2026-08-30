import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { Env } from '../env';
import { upsertUserFromGoogle } from '../services/userService';
import { signUserJwt } from '../services/jwtService';
import { currentUser, requireUser, resolveCurrentUser } from '../utils/auth';
import * as userService from '../services/userService';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const app = new Hono<{ Bindings: Env }>();

// Construct Google's OAuth2 token endpoint to exchange the authorization code
// for tokens. We verify the id_token via Google's JWKS in a real production
// setup; for this POC the userinfo endpoint + email verification is sufficient
// since we trust the redirect_uri is only reachable from our own origin.
async function exchangeCodeForTokens(env: Env, code: string): Promise<{ access_token: string; id_token: string }> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
    redirect_uri: env.GOOGLE_REDIRECT_URI ?? '',
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { access_token: string; id_token: string };
}

async function fetchGoogleUserinfo(env: Env, accessToken: string): Promise<{ sub: string; email: string; name?: string; picture?: string }> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { sub: string; email: string; name?: string; picture?: string };
}

app.get('/google/start', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const redirectUri = c.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return c.json(
      { error: 'GOOGLE_OAUTH_NOT_CONFIGURED', hint: 'Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI env vars.' },
      503,
    );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
});

app.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'MISSING_CODE' }, 400);
  try {
    const { access_token } = await exchangeCodeForTokens(c.env, code);
    const info = await fetchGoogleUserinfo(c.env, access_token);
    if (!info.email || !info.sub) return c.json({ error: 'INCOMPLETE_PROFILE' }, 400);

    const user = await upsertUserFromGoogle(c.env, {
      googleSub: info.sub,
      email: info.email,
      name: info.name,
      avatarUrl: info.picture,
    });

    const token = await signUserJwt(user.id, c.env.JWT_SECRET);
    setCookie(c, 'user_token', token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
      secure: c.env.ENVIRONMENT === 'production',
    });
    // Redirect to admin home in production; for local dev, expose the token
    // in a debug-friendly header.
    return c.redirect('/admin/presentations', 302);
  } catch (e) {
    return c.json({ error: 'OAUTH_CALLBACK_FAILED', message: (e as Error).message }, 400);
  }
});

app.get('/me', async (c) => {
  const userCookie = getCookie(c, 'user_token');
  const adminCookie = getCookie(c, 'admin_token');
  const user = await resolveCurrentUser(
    c.env,
    c.req.header('Authorization'),
    userCookie,
    adminCookie,
  );
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const memberships = user.isSuperAdmin
    ? await c.env.DB.prepare('SELECT event_id FROM event_admins').all<{ event_id: string }>()
    : await c.env.DB.prepare('SELECT event_id FROM event_admins WHERE user_id = ?')
        .bind(user.id)
        .all<{ event_id: string }>();
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isSuperAdmin: user.isSuperAdmin,
      authMethod: user.authMethod,
    },
    eventIds: memberships.results.map((r) => r.event_id),
  });
});

app.post('/logout', (c) => {
  deleteCookie(c, 'user_token', { path: '/' });
  return c.json({ ok: true });
});

// Admin invites — admin-only via the requireUser middleware.
app.post('/events/:id/admins', requireUser, async (c) => {
  const eventId = c.req.param('id')!;
  const body = (await c.req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim();
  if (!email) return c.json({ error: 'EMAIL_REQUIRED' }, 400);

  const u = c.get('user');

  const isAdmin = await userService.userIsEventAdmin(c.env, u.id, eventId);
  if (!isAdmin) return c.json({ error: 'FORBIDDEN' }, 403);

  try {
    const result = await userService.inviteEventAdmin(c.env, eventId, email, u.id);
    return c.json({ ok: true, user: result.user, role: result.role }, 201);
  } catch (e) {
    if (e instanceof userService.UserNotFoundError) {
      return c.json({ error: 'USER_NOT_FOUND', message: e.message }, 404);
    }
    throw e;
  }
});

app.get('/events/:id/admins', requireUser, async (c) => {
  const eventId = c.req.param('id')!;
  const u = c.get('user');
  const isAdmin = await userService.userIsEventAdmin(c.env, u.id, eventId);
  if (!isAdmin) return c.json({ error: 'FORBIDDEN' }, 403);
  const list = await userService.listEventAdmins(c.env, eventId);
  return c.json({
    admins: list.map((entry) => ({
      id: entry.user.id,
      email: entry.user.email,
      name: entry.user.name,
      avatarUrl: entry.user.avatarUrl,
      role: entry.role,
    })),
  });
});

app.delete('/events/:id/admins/:userId', requireUser, async (c) => {
  const eventId = c.req.param('id')!;
  const userId = c.req.param('userId')!;
  const u = c.get('user');
  const isAdmin = await userService.userIsEventAdmin(c.env, u.id, eventId);
  if (!isAdmin) return c.json({ error: 'FORBIDDEN' }, 403);
  const ok = await userService.removeEventAdmin(c.env, eventId, userId);
  if (!ok) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({ ok: true });
});

export default app;