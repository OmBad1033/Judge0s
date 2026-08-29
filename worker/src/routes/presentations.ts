import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { adminGuard } from '../utils/auth';
import * as presentationService from '../services/presentationService';
import * as defaultQuestionService from '../services/defaultQuestionService';

const app = new Hono<{ Bindings: Env }>();

const MAX_FILE_BYTES = 50 * 1024 * 1024;

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
  const slideCount = Number(form.get('slideCount'));
  const file = form.get('file') as File | string | null;

  if (!title) return c.json({ error: 'TITLE_REQUIRED' }, 400);
  if (!Number.isInteger(slideCount) || slideCount < 1) {
    return c.json({ error: 'INVALID_SLIDE_COUNT' }, 400);
  }
  if (file === null || typeof file === 'string') {
    return c.json({ error: 'FILE_REQUIRED' }, 400);
  }
  if (!/\.pptx$/i.test(file.name)) return c.json({ error: 'INVALID_FILE_TYPE' }, 400);
  if (file.size > MAX_FILE_BYTES) return c.json({ error: 'FILE_TOO_LARGE' }, 400);

  const presentation = await presentationService.createPresentation(c.env, {
    title,
    slideCount,
    file,
  });
  return c.json(presentation, 201);
});

app.get('/:id', adminGuard, async (c) => {
  const presentation = await presentationService.getPresentation(c.env, c.req.param('id'));
  if (!presentation) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(presentation);
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
