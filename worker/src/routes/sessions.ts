import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { adminGuard } from '../utils/auth';
import * as sessionService from '../services/sessionService';
import * as participantService from '../services/participantService';
import * as feedbackService from '../services/feedbackService';
import * as defaultResponseService from '../services/defaultResponseService';
import * as exportService from '../services/exportService';
import { rateLimit } from '../services/rateLimit';

const app = new Hono<{ Bindings: Env }>();

const createSchema = z.object({ presentationId: z.string().min(1) });
const slideSchema = z.object({ slideNumber: z.number().int().min(1) });
const joinSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});
const feedbackSchema = z.object({
  participantId: z.string().min(1),
  slideNumber: z.number().int().min(1),
  response: z.string(),
});

const defaultFeedbackSchema = z.object({
  participantId: z.string().min(1),
  defaultQuestionId: z.string().min(1),
  slideNumber: z.number().int().min(1),
  response: z.string(),
});

app.get('/', adminGuard, async (c) => {
  const presentationId = c.req.query('presentationId');
  if (!presentationId) return c.json({ error: 'VALIDATION_ERROR' }, 400);
  const sessions = await sessionService.listSessions(c.env, presentationId);
  return c.json({ sessions });
});

app.post('/', adminGuard, async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const result = await sessionService.createSession(c.env, parsed.data.presentationId);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.session, 201);
});

app.get('/:code', async (c) => {
  const session = await sessionService.getSession(c.env, c.req.param('code')!);
  if (!session) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(session);
});

app.post('/:code/start', adminGuard, async (c) => {
  const result = await sessionService.startSession(c.env, c.req.param('code')!);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.session);
});

app.patch('/:code/slide', adminGuard, async (c) => {
  const parsed = slideSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const result = await sessionService.changeSlide(c.env, c.req.param('code')!, parsed.data.slideNumber);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.session);
});

app.post('/:code/end', adminGuard, async (c) => {
  const result = await sessionService.endSession(c.env, c.req.param('code')!);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.session);
});

app.post('/:code/join', async (c) => {
  const parsed = joinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR' }, 400);
  }
  // Phase 8 — rate limit by IP + session code, 5/min.
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
  const rl = await rateLimit(c.env, { key: `join:${c.req.param('code')}:${ip}`, limit: 5 });
  if (!rl.ok) {
    return c.json({ error: 'RATE_LIMITED', resetIn: Math.ceil(rl.resetMs / 1000) }, 429);
  }
  const result = await participantService.joinSession(
    c.env,
    c.req.param('code')!,
    parsed.data.name,
    parsed.data.email,
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  // P2 §4.2 — notify live admin clients of the new participant count.
  if (result.data.status === 'live') {
    await sessionService.broadcastStats(c.env, c.req.param('code')!);
  }
  return c.json(result.data);
});

app.get('/:code/current-slide', async (c) => {
  const event = await sessionService.currentSlideEvent(c.env, c.req.param('code')!);
  if (!event) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(event);
});

// P1 §3.3 — atomic participant bootstrap (session + canonical event + responses).
app.get('/:code/participant-state', async (c) => {
  const code = c.req.param('code')!;
  const participantId = c.req.query('participantId') ?? '';
  const session = await sessionService.getSession(c.env, code);
  if (!session) return c.json({ error: 'NOT_FOUND' }, 404);

  const participant = await participantService.getParticipant(c.env, participantId);
  if (!participant || participant.sessionId !== session.id) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const event = await sessionService.currentSlideEvent(c.env, code);
  const responses = (await feedbackService.getMyFeedback(c.env, code, participantId)) ?? [];
  const defaultResponses = (await defaultResponseService.getMyDefaultFeedback(c.env, code, participantId)) ?? [];
  const existingResponse =
    session.currentSlideNumber != null
      ? responses.find((r) => r.slideNumber === session.currentSlideNumber) ?? null
      : null;

  return c.json({
    session: {
      sessionCode: session.sessionCode,
      status: session.status,
      presentationTitle: session.presentationTitle,
      currentSlideNumber: session.currentSlideNumber,
    },
    event: event ?? { type: 'NO_ACTIVE_SLIDE', status: session.status },
    existingResponse,
    responses,
    defaultResponses,
  });
});

// Phase 5 — mobile reconnect fallback (per backend_plan.md addendum).
// Cheap, no-DB-touch when possible; returns the same shape as participant-state
// for a known participant (or the lobby payload when the session is pending).
app.get('/:code/state', async (c) => {
  const code = c.req.param('code')!;
  const participantId = c.req.query('participantId') ?? '';
  const session = await sessionService.getSession(c.env, code);
  if (!session) return c.json({ error: 'NOT_FOUND' }, 404);

  if (!participantId) {
    return c.json({
      session: {
        sessionCode: session.sessionCode,
        status: session.status,
        presentationTitle: session.presentationTitle,
        currentSlideNumber: session.currentSlideNumber,
      },
    });
  }

  const participant = await participantService.getParticipant(c.env, participantId);
  if (!participant || participant.sessionId !== session.id) {
    return c.json({ error: 'PARTICIPANT_NOT_FOUND' }, 404);
  }

  const event = await sessionService.currentSlideEvent(c.env, code);
  const responses = (await feedbackService.getMyFeedback(c.env, code, participantId)) ?? [];
  const defaultResponses = (await defaultResponseService.getMyDefaultFeedback(c.env, code, participantId)) ?? [];
  const existingResponse =
    session.currentSlideNumber != null
      ? responses.find((r) => r.slideNumber === session.currentSlideNumber) ?? null
      : null;

  return c.json({
    session: {
      sessionCode: session.sessionCode,
      status: session.status,
      presentationTitle: session.presentationTitle,
      currentSlideNumber: session.currentSlideNumber,
    },
    event: event ?? { type: 'NO_ACTIVE_SLIDE', status: session.status },
    existingResponse,
    responses,
    defaultResponses,
  });
});

// Default-question feedback (interested / 0-10 rating) for the current slide.
app.post('/:code/feedback/default', async (c) => {
  const parsed = defaultFeedbackSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const result = await defaultResponseService.submitDefaultResponse(
    c.env,
    c.req.param('code')!,
    parsed.data.participantId,
    parsed.data.defaultQuestionId,
    parsed.data.slideNumber,
    parsed.data.response,
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.data, 201);
});

app.get('/:code/default-feedback/me', async (c) => {
  const participantId = c.req.query('participantId') ?? '';
  const responses = await defaultResponseService.getMyDefaultFeedback(c.env, c.req.param('code')!, participantId);
  if (responses === null) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({ responses });
});

// P2 §4.1 — admin control-room state (session, slide summaries, counts).
app.get('/:code/control-state', adminGuard, async (c) => {
  const data = await sessionService.getControlState(c.env, c.req.param('code')!);
  if (!data) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(data);
});

app.post('/:code/feedback', async (c) => {
  const parsed = feedbackSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR' }, 400);
  }
  // Phase 8 — rate limit by participant, 30/min.
  const rl = await rateLimit(c.env, { key: `fb:${parsed.data.participantId}`, limit: 30 });
  if (!rl.ok) {
    return c.json({ error: 'RATE_LIMITED', resetIn: Math.ceil(rl.resetMs / 1000) }, 429);
  }
  const result = await feedbackService.submitFeedback(
    c.env,
    c.req.param('code')!,
    parsed.data.participantId,
    parsed.data.slideNumber,
    parsed.data.response,
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.data, 201);
});

app.get('/:code/feedback/me', async (c) => {
  const participantId = c.req.query('participantId') ?? '';
  const responses = await feedbackService.getMyFeedback(c.env, c.req.param('code')!, participantId);
  if (responses === null) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({ responses });
});

app.get('/:code/export', adminGuard, async (c) => {
  const data = await exportService.exportSession(c.env, c.req.param('code')!);
  if (!data) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(data);
});

// Phase 6 — CSV variant of the per-session export.
app.get('/:code/export.csv', adminGuard, async (c) => {
  const data = await exportService.exportSession(c.env, c.req.param('code')!);
  if (!data) return c.json({ error: 'NOT_FOUND' }, 404);
  const csv = exportService.sessionToCSV(data);
  return c.text(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="session-${data.session.code}.csv"`,
  });
});

export default app;
