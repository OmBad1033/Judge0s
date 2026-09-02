// AI Slide Config — Phases 2-3. Real AI endpoints under an event, all
// owner-plan-gated by requirePaidPlan.
//
//   POST /api/events/:id/ai/generate                 — run suggestion generation
//   POST /api/events/:id/ai/slides/:slideNumber/generate — per-slide generation
//   GET  /api/events/:id/ai/suggestions              — list pending suggestions
//   POST /api/events/:id/ai/suggestions/:slideId/approve  — apply + optional edits
//   POST /api/events/:id/ai/suggestions/:slideId/reject   — discard
//   POST /api/events/:id/ai/suggestions/:slideId/revise   — regenerate w/ comments
//   GET  /api/events/:id/ai/context                  — deck-level context (settings; no trial)
//   PUT  /api/events/:id/ai/context                  — save deck-level context
//   POST /api/events/:id/ai/chat                     — Phase 4 (501)
//   POST /api/events/:id/ai/chat/apply               — Phase 4 (501)

import { Hono } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { requirePaidPlan, requireAiEntitled, type AiContext } from '../utils/requirePaidPlan';
import type { CurrentUser } from '../utils/auth';
import * as aiSuggestionService from '../services/aiSuggestionService';
import * as approvalService from '../services/approvalService';
import { getEventAiContext, setEventAiContext } from '../services/eventService';
import { rateLimit, rateLimitHeaders } from '../services/rateLimit';

const app = new Hono<AiContext>();

const GENERATE_LIMIT = 3; // per minute, per event
const REVISE_LIMIT = 10;

const approveSchema = z.object({
  title: z.string().max(300).optional(),
  summary: z.string().max(4000).optional(),
  comment: z.string().max(2000).optional(),
});

const rejectSchema = z.object({
  comment: z.string().max(2000).optional(),
});

const reviseSchema = z.object({
  comments: z.string().min(1).max(2000),
});

const contextSchema = z.object({
  context: z.string().max(4000).optional(),
});

function actorOf(c: { get: (k: 'user') => CurrentUser }): { actorId: string; actorKind: 'user' | 'admin_cookie' } {
  const u = c.get('user');
  return { actorId: u.id, actorKind: u.authMethod === 'legacy_admin_cookie' ? 'admin_cookie' : 'user' };
}

// POST /api/events/:id/ai/generate
app.post('/generate', requirePaidPlan, async (c) => {
  const eventId = c.req.param('id')!;
  const rl = await rateLimit(c.env, { key: `ai_generate:${eventId}`, limit: GENERATE_LIMIT });
  for (const [k, v] of Object.entries(rateLimitHeaders(rl, GENERATE_LIMIT))) c.header(k, v);
  if (!rl.ok) return c.json({ error: 'RATE_LIMITED' }, 429);

  const result = await aiSuggestionService.generateForPresentation(c.env, eventId);
  if (!result.ok) {
    const status = result.status ?? 400;
    return c.json({ error: result.error }, status as ContentfulStatusCode);
  }
  return c.json({
    ok: true,
    slides: result.slides,
    jobId: result.jobId,
    cached: result.cached,
  });
});

// GET /api/events/:id/ai/context — deck-level "what are we building" context.
// Read-only, so it uses the non-consuming gate (a free user's one-presentation
// trial shouldn't be spent just opening the context editor).
app.get('/context', requireAiEntitled, async (c) => {
  const eventId = c.req.param('id')!;
  const context = await getEventAiContext(c.env, eventId);
  return c.json({ context });
});

// PUT /api/events/:id/ai/context — save the deck-level context. Passing an
// empty/absent context clears it. Saving invalidates the deck-level suggestion
// cache because the stored suggestions were generated under the old context.
app.put('/context', requirePaidPlan, async (c) => {
  const eventId = c.req.param('id')!;
  const parsed = contextSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);

  const next = parsed.data.context?.trim() || null;
  const ok = await setEventAiContext(c.env, eventId, next);
  if (!ok) return c.json({ error: 'NOT_FOUND' }, 404);

  // The deck-level cache encodes the previous context; drop it so the next
  // "generate all" runs under the new context.
  await aiSuggestionService.invalidateSuggestionCache(c.env, eventId);
  return c.json({ ok: true, context: next });
});

// POST /api/events/:id/ai/slides/:slideNumber/generate — per-slide suggestion.
// Used by "Generate for this slide". Regenerating one slide invalidates the
// deck-level cache so the deck button always reflects fresh per-slide content.
app.post('/slides/:slideNumber/generate', requirePaidPlan, async (c) => {
  const eventId = c.req.param('id')!;
  const slideNumber = Number(c.req.param('slideNumber'));
  if (!Number.isInteger(slideNumber) || slideNumber < 1) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'slideNumber must be a positive integer' }, 400);
  }
  const rl = await rateLimit(c.env, { key: `ai_generate_slide:${eventId}`, limit: GENERATE_LIMIT });
  for (const [k, v] of Object.entries(rateLimitHeaders(rl, GENERATE_LIMIT))) c.header(k, v);
  if (!rl.ok) return c.json({ error: 'RATE_LIMITED' }, 429);

  const result = await aiSuggestionService.generateForSlide(c.env, eventId, slideNumber);
  if (!result.ok) {
    const status = result.status ?? 400;
    return c.json({ error: result.error }, status as ContentfulStatusCode);
  }
  return c.json({
    ok: true,
    slideNumber,
    suggestion: result.suggestion,
    cached: result.cached,
  });
});

// GET /api/events/:id/ai/suggestions
app.get('/suggestions', requirePaidPlan, async (c) => {
  const eventId = c.req.param('id')!;
  const suggestions = await aiSuggestionService.listSuggestions(c.env, eventId);
  return c.json({ suggestions });
});

// POST /api/events/:id/ai/suggestions/:slideId/approve
app.post('/suggestions/:slideId/approve', requirePaidPlan, async (c) => {
  const eventId = c.req.param('id')!;
  const slideId = c.req.param('slideId')!;
  const parsed = approveSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);

  const actor = actorOf(c);
  const result = await approvalService.approveSlideSuggestion(c.env, eventId, slideId, {
    ...actor,
    title: parsed.data.title,
    summary: parsed.data.summary,
    comment: parsed.data.comment,
  });
  if (!result.ok) return c.json({ error: result.error }, result.status as ContentfulStatusCode);
  return c.json({ ok: true });
});

// POST /api/events/:id/ai/suggestions/:slideId/reject
app.post('/suggestions/:slideId/reject', requirePaidPlan, async (c) => {
  const eventId = c.req.param('id')!;
  const slideId = c.req.param('slideId')!;
  const parsed = rejectSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);

  const actor = actorOf(c);
  const result = await approvalService.rejectSlideSuggestion(c.env, eventId, slideId, {
    ...actor,
    comment: parsed.data.comment,
  });
  if (!result.ok) return c.json({ error: result.error }, result.status as ContentfulStatusCode);
  return c.json({ ok: true });
});

// POST /api/events/:id/ai/suggestions/:slideId/revise
// Admin comment → model regenerates that slide's suggestion (still pending).
app.post('/suggestions/:slideId/revise', requirePaidPlan, async (c) => {
  const eventId = c.req.param('id')!;
  const slideId = c.req.param('slideId')!;
  const rl = await rateLimit(c.env, { key: `ai_revise:${eventId}:${slideId}`, limit: REVISE_LIMIT });
  for (const [k, v] of Object.entries(rateLimitHeaders(rl, REVISE_LIMIT))) c.header(k, v);
  if (!rl.ok) return c.json({ error: 'RATE_LIMITED' }, 429);

  const parsed = reviseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);

  try {
    const updated = await aiSuggestionService.reviseSlideSuggestion(
      c.env,
      eventId,
      slideId,
      parsed.data.comments,
    );
    if (!updated) return c.json({ error: 'SLIDE_NOT_FOUND' }, 404);
    return c.json({ ok: true, suggestion: updated });
  } catch (e) {
    return c.json({ error: 'GENERATION_FAILED', message: (e as Error).message }, 502);
  }
});

// Phase 4 — conversational chat config (still stubs).
const notImplemented = { error: 'NOT_IMPLEMENTED', message: 'AI feature coming in a later phase.' };
app.post('/chat', requirePaidPlan, async (c) => c.json(notImplemented, 501));
app.post('/chat/apply', requirePaidPlan, async (c) => c.json(notImplemented, 501));

export default app;
