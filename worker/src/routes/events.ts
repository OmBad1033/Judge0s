import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { currentUser, requireUser } from '../utils/auth';
import * as eventService from '../services/eventService';
import * as presentationService from '../services/presentationService';
import * as sessionService from '../services/sessionService';
import * as exportService from '../services/exportService';
import * as slideService from '../services/slideService';
import { feedbackFieldsArraySchema } from '../validation/feedback';

const MAX_FILE_BYTES = 400 * 1024 * 1024;

const app = new Hono<{ Bindings: Env }>();

const createEventSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const patchEventSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'configured', 'archived']).optional(),
});

// Helper — `requireUser` + resolve user
async function currentUserOr(c: { env: Env; req: { header: (n: string) => string | undefined } }) {
  return currentUser(c);
}

app.post('/', requireUser, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  const user = c.get('user');
  const ev = await eventService.createEvent(c.env, { ...parsed.data, ownerId: user.id });
  return c.json(ev, 201);
});

app.get('/', requireUser, async (c) => {
  const user = c.get('user');
  const events = await eventService.listEventsForUser(c.env, user.id, { isSuperAdmin: user.isSuperAdmin });
  return c.json({ events });
});

app.get('/:id', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(ev);
});

app.patch('/:id', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  const user = c.get('user');
  if (ev.ownerId !== user.id && !user.isSuperAdmin) return c.json({ error: 'FORBIDDEN' }, 403);
  const parsed = patchEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  const updated = await eventService.patchEvent(c.env, ev.id, parsed.data);
  return c.json(updated);
});

app.delete('/:id', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  const user = c.get('user');
  if (ev.ownerId !== user.id && !user.isSuperAdmin) return c.json({ error: 'FORBIDDEN' }, 403);
  const ok = await eventService.deleteEvent(c.env, ev.id);
  return c.json({ ok });
});

// Sessions on an event
app.get('/:id/sessions', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  // The compat layer treats presentationId === eventId (we wired them up that way in 0005).
  const sessions = await sessionService.listSessions(c.env, ev.id);
  return c.json({ sessions });
});

app.post('/:id/sessions', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  const result = await sessionService.createSession(c.env, ev.id);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.session, 201);
});

// Presentation upload on an event (Phase 7 additive)
app.post('/:id/presentation', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  const form = await c.req.formData();
  const title = String(form.get('title') ?? '').trim();
  const slideCountRaw = form.get('slideCount');
  const file = form.get('file') as File | string | null;
  if (!title) return c.json({ error: 'TITLE_REQUIRED' }, 400);
  if (file === null || typeof file === 'string') return c.json({ error: 'FILE_REQUIRED' }, 400);
  if (!/\.(pptx|pdf)$/i.test(file.name)) return c.json({ error: 'INVALID_FILE_TYPE' }, 400);
  if (file.size > MAX_FILE_BYTES) return c.json({ error: 'FILE_TOO_LARGE' }, 400);

  // Slide count is derived from the uploaded file (PDF page count / PPTX slide
  // count); the optional form field is only used as a fallback override.
  let slideCount: number | undefined;
  const n = Number(slideCountRaw);
  if (Number.isInteger(n) && n >= 1) slideCount = n;

  const user = c.get('user');
  const p = await presentationService.createPresentation(
    c.env,
    { title, slideCount, file, eventId: ev.id },
    { uploadedBy: user.id },
  );
  return c.json(p, 201);
});

app.get('/:id/presentation', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  const status = await presentationService.getPresentationStatus(c.env, ev.id);
  return c.json(status ?? { status: 'processing' });
});

// Phase 3 — form builder: replace the field set for a slide.
app.put('/:id/slides/:slideId/fields', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  const slideId = c.req.param('slideId')!;
  const parsed = feedbackFieldsArraySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  // Verify the slide belongs to this event.
  const slide = await c.env.DB.prepare('SELECT id FROM slides WHERE id = ? AND presentation_id = ?')
    .bind(slideId, ev.id)
    .first<{ id: string }>();
  if (!slide) return c.json({ error: 'SLIDE_NOT_FOUND' }, 404);

  const fields = await slideService.replaceSlideFields(c.env, slideId, parsed.data);
  return c.json({ slideId, fields });
});

// Phase 3 — list the field set for a slide.
app.get('/:id/slides/:slideId/fields', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  const slideId = c.req.param('slideId')!;
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM feedback_fields WHERE slide_id = ? ORDER BY order_index',
  )
    .bind(slideId)
    .all();
  return c.json({ slideId, fields: results });
});

// Event-level export (Phase 6)
app.get('/:id/export', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  const data = await exportService.exportEvent(c.env, ev.id);
  return c.json(data);
});

app.get('/:id/export.csv', requireUser, async (c) => {
  const ev = await eventService.getEvent(c.env, c.req.param('id')!);
  if (!ev) return c.json({ error: 'NOT_FOUND' }, 404);
  const data = await exportService.exportEvent(c.env, ev.id);
  const csv = exportService.eventToCSV(data);
  return c.text(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="event-${ev.id}.csv"`,
  });
});

export default app;