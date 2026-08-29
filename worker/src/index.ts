import { Hono } from 'hono';
import type { Env } from './env';
import { PresentationSession } from './durable-objects/PresentationSession';
import auth from './routes/auth';
import presentations from './routes/presentations';
import slides from './routes/slides';
import sessions from './routes/sessions';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  return c.json({ status: 'ok', db: row?.ok === 1 });
});

app.route('/api/admin', auth);
app.route('/api/presentations', presentations);
app.route('/api/presentations/:id/slides', slides);
app.route('/api/sessions', sessions);

// WebSocket upgrade: hand off to the PresentationSession Durable Object.
app.get('/ws/session/:code', (c) => {
  const id = c.env.PRESENTATION_SESSION.idFromName(c.req.param('code')!);
  const stub = c.env.PRESENTATION_SESSION.get(id);
  return stub.fetch(c.req.raw);
});

// Single-unit frontend: serve static assets / SPA for everything else.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
export { PresentationSession };
