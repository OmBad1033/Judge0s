import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { adminGuard, currentUser } from '../utils/auth';
import * as presentationService from '../services/presentationService';
import * as defaultQuestionService from '../services/defaultQuestionService';
import * as eventService from '../services/eventService';

const app = new Hono<{ Bindings: Env }>();

const MAX_FILE_BYTES = 400 * 1024 * 1024;

const defaultQuestionSchema = z.object({
  questionText: z.string().min(1),
  questionType: z.enum(['interested', 'rating']),
  targetSlides: z.array(z.number().int().min(1)).min(1),
});

app.get('/', adminGuard, async (c) => {
  const presentations = await presentationService.listPresentations(c.env);
  return c.json({ presentations });
});

app.post('/', adminGuard, async (c) => {
  const form = await c.req.formData();
  const title = String(form.get('title') ?? '').trim();
  const slideCountRaw = form.get('slideCount');
  const file = form.get('file') as File | string | null;

  if (!title) return c.json({ error: 'TITLE_REQUIRED' }, 400);
  if (file === null || typeof file === 'string') {
    return c.json({ error: 'FILE_REQUIRED' }, 400);
  }
  if (!/\.(pptx|pdf)$/i.test(file.name)) return c.json({ error: 'INVALID_FILE_TYPE' }, 400);
  if (file.size > MAX_FILE_BYTES) return c.json({ error: 'FILE_TOO_LARGE' }, 400);

  // Slide count is derived from the uploaded file (PDF page count / PPTX slide
  // count); the optional form field is only used as a fallback override.
  let slideCount: number | undefined;
  const n = Number(slideCountRaw);
  if (Number.isInteger(n) && n >= 1) slideCount = n;

  // Phase 2 — auto-create an Event for the presentation so the legacy
  // `presentationId` parameter and the new `eventId` are the same value.
  // AI gating (Phase 0/1) is owner-plan based, so the event owner must be the
  // actual uploading user, not the synthetic local-admin.
  const uploader = await currentUser(c);
  const ownerId = uploader?.id ?? 'local-admin';
  const ev = await eventService.createEvent(c.env, { name: title, ownerId });
  const presentation = await presentationService.createPresentation(
    c.env,
    { title, slideCount, file, eventId: ev.id },
    { uploadedBy: ownerId },
  );
  return c.json(presentation, 201);
});

app.get('/:id', adminGuard, async (c) => {
  const presentation = await presentationService.getPresentation(c.env, c.req.param('id'));
  if (!presentation) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(presentation);
});

app.delete('/:id', adminGuard, async (c) => {
  const ok = await presentationService.deletePresentation(c.env, c.req.param('id'));
  if (!ok) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({ ok: true });
});

app.get('/:id/default-questions', adminGuard, async (c) => {
  const list = await defaultQuestionService.listDefaultQuestions(c.env, c.req.param('id')!);
  return c.json({ defaultQuestions: list });
});

app.post('/:id/default-questions', adminGuard, async (c) => {
  const parsed = defaultQuestionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const q = await defaultQuestionService.createDefaultQuestion(c.env, c.req.param('id')!, parsed.data);
  return c.json(q, 201);
});

app.delete('/:id/default-questions/:qid', adminGuard, async (c) => {
  const ok = await defaultQuestionService.deleteDefaultQuestion(c.env, c.req.param('id')!, c.req.param('qid')!);
  if (!ok) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({ ok: true });
});

export default app;
