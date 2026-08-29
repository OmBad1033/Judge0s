import type { Env } from '../env';
import { newId, now } from '../utils/common';
import { generateSessionCode } from '../utils/sessionCode';
import * as slideService from './slideService';
import * as defaultQuestionService from './defaultQuestionService';
import type { Slide } from './slideService';

export interface Session {
  id: string;
  presentationId: string;
  sessionCode: string;
  status: 'draft' | 'live' | 'ended';
  currentSlideNumber: number | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface SessionWithPresentation extends Session {
  presentationTitle: string;
  slideCount: number;
}

type Result<T> = { ok: true; session: T } | { ok: false; error: string; status: 400 | 404 | 409 | 500 };

const err = (error: string, status: 400 | 404 | 409 | 500): { ok: false; error: string; status: 400 | 404 | 409 | 500 } => ({
  ok: false,
  error,
  status,
});

function mapSession(r: Record<string, unknown>): SessionWithPresentation {
  return {
    id: r.id as string,
    presentationId: r.presentation_id as string,
    sessionCode: r.session_code as string,
    status: r.status as Session['status'],
    currentSlideNumber: (r.current_slide_number as number) ?? null,
    createdAt: r.created_at as string,
    startedAt: (r.started_at as string) ?? null,
    endedAt: (r.ended_at as string) ?? null,
    presentationTitle: r.presentation_title as string,
    slideCount: r.slide_count as number,
  };
}

function buildSlideChangedPayload(slide: Slide) {
  const rule = slide.feedbackRule;
  return {
    type: 'SLIDE_CHANGED' as const,
    slideNumber: slide.slideNumber,
    slide: {
      slideNumber: slide.slideNumber,
      title: slide.title,
      summary: slide.summary,
    },
    feedbackRule: rule
      ? {
          enabled: rule.enabled,
          required: rule.required,
          type: rule.feedbackType,
          question: rule.question,
          options: rule.options,
          allowResubmission: rule.allowResubmission,
        }
      : {
          enabled: false,
          required: false,
          type: 'disabled' as const,
          question: null,
          options: null,
          allowResubmission: false,
        },
  };
}

// Payload for slides the admin never configured: track the slide number but
// show no content and no feedback form (i.e. ignore it).
function blankSlidePayload(slideNumber: number) {
  return {
    type: 'SLIDE_CHANGED' as const,
    slideNumber,
    slide: { slideNumber, title: null, summary: null },
    feedbackRule: {
      enabled: false,
      required: false,
      type: 'disabled' as const,
      question: null,
      options: null,
      allowResubmission: false,
    },
  };
}

// Attach the default questions that target this slide so participants can
// answer generic questions (e.g. interested / 0-10 rating) in addition to the
// slide's own rule. Works for configured and blank slides alike.
async function composeSlidePayload(
  env: Env,
  presentationId: string,
  slide: Slide | null,
  slideNumber: number,
) {
  const base = slide ? buildSlideChangedPayload(slide) : blankSlidePayload(slideNumber);
  const dqs = await defaultQuestionService.getDefaultQuestionsForSlide(env, presentationId, slideNumber);
  return {
    ...base,
    defaultQuestions: dqs.map((dq) => ({
      id: dq.id,
      questionText: dq.questionText,
      questionType: dq.questionType,
    })),
  };
}

async function notifyDO(env: Env, code: string, message: unknown): Promise<void> {
  const id = env.PRESENTATION_SESSION.idFromName(code);
  const stub = env.PRESENTATION_SESSION.get(id);
  await stub.fetch(
    new Request('https://presentation-session/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    }),
  );
}

export async function getSession(env: Env, code: string): Promise<SessionWithPresentation | null> {
  const row = await env.DB.prepare(
    `SELECT s.*, p.title AS presentation_title, p.slide_count AS slide_count
     FROM presentation_sessions s
     JOIN presentations p ON p.id = s.presentation_id
     WHERE s.session_code = ?`,
  )
    .bind(code)
    .first();
  return row ? mapSession(row) : null;
}

export async function createSession(
  env: Env,
  presentationId: string,
): Promise<Result<SessionWithPresentation>> {
  const presentation = await env.DB.prepare('SELECT id FROM presentations WHERE id = ?')
    .bind(presentationId)
    .first();
  if (!presentation) return err('PRESENTATION_NOT_FOUND', 404);

  const createdAt = now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateSessionCode();
    try {
      await env.DB.prepare(
        `INSERT INTO presentation_sessions (id, presentation_id, session_code, status, current_slide_number, created_at)
         VALUES (?, ?, ?, 'draft', NULL, ?)`,
      )
        .bind(newId(), presentationId, code, createdAt)
        .run();
      const session = await getSession(env, code);
      return { ok: true, session: session! };
    } catch (e) {
      if ((e as Error).message?.includes('UNIQUE')) continue; // code collision, retry
      throw e;
    }
  }
  return err('CODE_GENERATION_FAILED', 500);
}

export async function startSession(env: Env, code: string): Promise<Result<SessionWithPresentation>> {
  const session = await getSession(env, code);
  if (!session) return err('NOT_FOUND', 404);
  if (session.status === 'ended') return err('SESSION_ENDED', 409);

  const slide = await slideService.getSlideByNumber(env, session.presentationId, 1);
  const payload = await composeSlidePayload(env, session.presentationId, slide, 1);

  await env.DB.prepare(
    `UPDATE presentation_sessions
     SET status = 'live', current_slide_number = 1, started_at = COALESCE(started_at, ?)
     WHERE session_code = ?`,
  )
    .bind(now(), code)
    .run();

  await notifyDO(env, code, payload);
  return { ok: true, session: (await getSession(env, code))! };
}

export async function changeSlide(
  env: Env,
  code: string,
  slideNumber: number,
): Promise<Result<SessionWithPresentation>> {
  const session = await getSession(env, code);
  if (!session) return err('NOT_FOUND', 404);
  if (session.status !== 'live') return err('SESSION_NOT_LIVE', 409);
  if (slideNumber < 1 || slideNumber > session.slideCount) return err('SLIDE_OUT_OF_RANGE', 400);

  const slide = await slideService.getSlideByNumber(env, session.presentationId, slideNumber);
  const payload = await composeSlidePayload(env, session.presentationId, slide, slideNumber);

  await env.DB.prepare('UPDATE presentation_sessions SET current_slide_number = ? WHERE session_code = ?')
    .bind(slideNumber, code)
    .run();

  await notifyDO(env, code, payload);
  return { ok: true, session: (await getSession(env, code))! };
}

export async function endSession(env: Env, code: string): Promise<Result<SessionWithPresentation>> {
  const session = await getSession(env, code);
  if (!session) return err('NOT_FOUND', 404);
  if (session.status !== 'live') return err('SESSION_NOT_LIVE', 409);

  await env.DB.prepare("UPDATE presentation_sessions SET status = 'ended', ended_at = ? WHERE session_code = ?")
    .bind(now(), code)
    .run();

  await notifyDO(env, code, { type: 'SESSION_ENDED' });
  return { ok: true, session: (await getSession(env, code))! };
}

// Snapshot of the current slide as a SLIDE_CHANGED-shaped event, for initial
// client state (on join / WS connect / reconnect).
export async function currentSlideEvent(env: Env, code: string): Promise<Record<string, unknown> | null> {
  const session = await getSession(env, code);
  if (!session) return null;
  if (session.currentSlideNumber == null) {
    return { type: 'NO_ACTIVE_SLIDE', status: session.status };
  }
  const slide = await slideService.getSlideByNumber(env, session.presentationId, session.currentSlideNumber);
  return (await composeSlidePayload(env, session.presentationId, slide, session.currentSlideNumber)) as Record<
    string,
    unknown
  >;
}

// P1 §3.2 — session discovery for a presentation (newest first).
export async function listSessions(env: Env, presentationId: string): Promise<SessionWithPresentation[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.*, p.title AS presentation_title, p.slide_count AS slide_count
     FROM presentation_sessions s
     JOIN presentations p ON p.id = s.presentation_id
     WHERE s.presentation_id = ?
     ORDER BY s.created_at DESC`,
  )
    .bind(presentationId)
    .all();
  return (results as Record<string, unknown>[]).map(mapSession);
}

async function countQuery(env: Env, sql: string, ...binds: (string | number)[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

// P2 §4.1 — control-room state: session, all slide summaries, participant/response counts.
export interface ControlState {
  session: SessionWithPresentation;
  slides: {
    slideNumber: number;
    title: string | null;
    summary: string | null;
    configured: boolean;
    feedbackType: string;
  }[];
  participantCount: number;
  responseCount: number;
  currentSlideResponseCount: number;
}

export async function getControlState(env: Env, code: string): Promise<ControlState | null> {
  const session = await getSession(env, code);
  if (!session) return null;

  const configured = await slideService.listSlides(env, session.presentationId);
  const byNum = new Map(configured.map((s) => [s.slideNumber, s]));
  const slides = Array.from({ length: session.slideCount }, (_, i) => {
    const n = i + 1;
    const s = byNum.get(n);
    return {
      slideNumber: n,
      title: s?.title ?? null,
      summary: s?.summary ?? null,
      configured: !!s,
      feedbackType: s?.feedbackRule?.feedbackType ?? 'disabled',
    };
  });

  const participantCount = await countQuery(
    env,
    'SELECT COUNT(*) AS c FROM participants WHERE session_id = ?',
    session.id,
  );
  const responseCount = await countQuery(
    env,
    'SELECT COUNT(*) AS c FROM feedback_responses WHERE session_id = ?',
    session.id,
  );
  let currentSlideResponseCount = 0;
  if (session.currentSlideNumber != null) {
    currentSlideResponseCount = await countQuery(
      env,
      `SELECT COUNT(*) AS c FROM feedback_responses fr
       JOIN slides s ON s.id = fr.slide_id
       WHERE fr.session_id = ? AND s.slide_number = ?`,
      session.id,
      session.currentSlideNumber,
    );
  }

  return { session, slides, participantCount, responseCount, currentSlideResponseCount };
}

// P2 §4.2 — broadcast aggregate counts (no PII) to the session's live clients.
export async function broadcastStats(env: Env, code: string): Promise<void> {
  const session = await getSession(env, code);
  if (!session) return;
  const participantCount = await countQuery(
    env,
    'SELECT COUNT(*) AS c FROM participants WHERE session_id = ?',
    session.id,
  );
  let currentSlideResponseCount = 0;
  if (session.currentSlideNumber != null) {
    currentSlideResponseCount = await countQuery(
      env,
      `SELECT COUNT(*) AS c FROM feedback_responses fr
       JOIN slides s ON s.id = fr.slide_id
       WHERE fr.session_id = ? AND s.slide_number = ?`,
      session.id,
      session.currentSlideNumber,
    );
  }
  await notifyDO(env, code, {
    type: 'SESSION_STATS_UPDATED',
    participantCount,
    currentSlideResponseCount,
  });
}
