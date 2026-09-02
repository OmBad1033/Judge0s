import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { adminGuard } from '../utils/auth';
import * as presentationService from '../services/presentationService';
import * as slideService from '../services/slideService';
import { feedbackRuleConfigSchema } from '../validation/feedback';

const app = new Hono<{ Bindings: Env }>();

const putSlideSchema = z.object({
  title: z.string().optional(),
  summary: z.string().min(1),
  feedbackRule: feedbackRuleConfigSchema,
});

app.get('/', adminGuard, async (c) => {
  const presentationId = c.req.param('id')!;
  const presentation = await presentationService.getPresentation(c.env, presentationId);
  if (!presentation) return c.json({ error: 'NOT_FOUND' }, 404);

  // Lazy extraction — the first time the configure screen loads, run the
  // per-slide extraction and store the extracted content in R2 (upload only
  // stored the original file + count). This is the "update and configure"
  // moment: by the time the configure page finishes loading, the extracted
  // JSON/Markdown objects exist and the AI configure path can read them.
  // Failures are recorded on the file row and retried on the next load.
  await presentationService.ensurePresentationExtracted(c.env, presentationId);

  const slides = await slideService.listSlides(c.env, presentationId);
  return c.json({ presentation, slides });
});

app.put('/:slideNumber', adminGuard, async (c) => {
  const presentationId = c.req.param('id')!;
  const slideNumber = Number(c.req.param('slideNumber'));
  if (!Number.isInteger(slideNumber) || slideNumber < 1) {
    return c.json({ error: 'INVALID_SLIDE_NUMBER' }, 400);
  }

  const presentation = await presentationService.getPresentation(c.env, presentationId);
  if (!presentation) return c.json({ error: 'NOT_FOUND' }, 404);
  if (slideNumber > presentation.slideCount) {
    return c.json({ error: 'SLIDE_OUT_OF_RANGE' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = putSlideSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }

  const slide = await slideService.upsertSlide(c.env, presentationId, slideNumber, parsed.data);
  return c.json(slide);
});

export default app;
