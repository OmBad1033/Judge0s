import { Hono } from 'hono';
import type { Env } from './env';
import { SessionRoom } from './durable-objects/SessionRoom';
import auth from './routes/auth';
import authGoogle from './routes/auth_google';
import events from './routes/events';
import presentations from './routes/presentations';
import slides from './routes/slides';
import sessions from './routes/sessions';

const app = new Hono<{ Bindings: Env }>();

// Phase 8 — CORS lockdown. Only allow configured origins; default to the
// local Vite dev origin so the existing frontend continues to work.
const allowOrigins = (env: Env, origin: string | undefined): string | null => {
  if (!origin) return null;
  const list = (env.ORIGIN_ALLOWLIST ?? 'http://localhost:5173')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  return list.includes(origin) ? origin : null;
};

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const allowed = allowOrigins(c.env, origin);
  if (allowed) {
    c.header('Access-Control-Allow-Origin', allowed);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Credentials', 'true');
  }
  if (c.req.method === 'OPTIONS') {
    if (allowed) {
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', c.req.header('Access-Control-Request-Headers') ?? 'Content-Type, Authorization');
      c.header('Access-Control-Max-Age', '600');
    }
    return c.body(null, allowed ? 204 : 403);
  }
  await next();
});

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  return c.json({
    status: 'ok',
    db: row?.ok === 1,
    service: 'live-feedback-worker',
    version: '0.1.0',
  });
});

app.route('/api/admin', auth);
// Phase 1 — Google OAuth + per-event admin management.
app.route('/api/auth', authGoogle);
// Phase 2 — Events + Sessions (new, additive).
app.route('/api/events', events);
app.route('/api/presentations', presentations);
app.route('/api/presentations/:id/slides', slides);
app.route('/api/sessions', sessions);

// Phase 4 — WebSocket upgrade routes the connection to the SessionRoom DO
// with a `?role=` query so the DO knows whether to send slide_changed
// events (participants) or stats updates (admins).
app.get('/ws/session/:code', (c) => {
  const id = c.env.PRESENTATION_SESSION.idFromName(c.req.param('code')!);
  const stub = c.env.PRESENTATION_SESSION.get(id);
  return stub.fetch(c.req.raw);
});

// Single-unit frontend: serve static assets / SPA for everything else.
// In local dev (wrangler.dev.jsonc) there is no ASSETS binding — the Vite
// dev server serves the frontend and proxies /api and /ws to this worker.
app.get('*', (c) => {
  if (!c.env.ASSETS) return c.text('Not Found', 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
export { SessionRoom };