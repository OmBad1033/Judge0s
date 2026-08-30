import type { Env } from '../env';
import { newId, now } from '../utils/common';
import { generateSessionCode } from '../utils/sessionCode';
import * as slideService from './slideService';
import * as defaultQuestionService from './defaultQuestionService';
import { eventIdFromPresentation } from './eventService';
import type { Slide } from './slideService';

// Legacy wire shape — preserved exactly so the existing frontend doesn't break.
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

// Map new state (pending | live | paused | ended) → legacy state (draft | live | ended).
function toLegacyStatus(status: string): Session['status'] {
  switch (status) {
    case 'pending': return 'draft';
    case 'live':    return 'live';
    case 'paused':  return 'live';
    case 'ended':   return 'ended';
    default:        return 'draft';
  }
}

function fromLegacyStatus(legacy: Session['status']): 'pending' | 'live' | 'ended' {
  switch (legacy) {
    case 'draft': return 'pending';
    case 'live':  return 'live';
    case 'ended': return 'ended';
  }
}

interface JoinedSession {
  id: string;
  event_id: string;
  session_code: string;
  status: string;
  current_slide_id: string | null;
  created_by: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  presentation_title: string;
  slide_count: number;
  presentation_id: string;
}

async function getJoinedSession(env: Env, code: string): Promise<JoinedSession | null> {
  const row = await env.DB.prepare(
    `SELECT s.*, e.name AS presentation_title,
            COALESCE((SELECT pf.slide_count FROM presentation_files pf WHERE pf.event_id = s.event_id ORDER BY pf.uploaded_at DESC LIMIT 1), 0) AS slide_count,
            s.event_id AS presentation_id
     FROM sessions s
     JOIN events e ON e.id = s.event_id
     WHERE s.session_code = ?`,
  )
    .bind(code)
    .first();
  return row as JoinedSession | null;
}

function mapSession(row: JoinedSession): SessionWithPresentation {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    sessionCode: row.session_code,
    status: toLegacyStatus(row.status),
    currentSlideNumber: null, // resolved per-call via the slideService
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    presentationTitle: row.presentation_title,
    slideCount: row.slide_count,
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

// Worker → DO RPC. Hides the fetch round-trip so callers can use typed helpers.
async function callDO(env: Env, code: string, command: string, body: Record<string, unknown> = {}): Promise<Response> {
  const id = env.PRESENTATION_SESSION.idFromName(code);
  const stub = env.PRESENTATION_SESSION.get(id);
  return stub.fetch(
    new Request(`https://session-room/${command}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, ...body }),
    }),
  );
}

async function notifyParticipants(env: Env, code: string, message: unknown): Promise<void> {
  await callDO(env, code, 'broadcastToParticipants', { message });
}

async function notifyAdmins(env: Env, code: string, message: unknown): Promise<void> {
  await callDO(env, code, 'broadcastToAdmins', { message });
}

async function broadcastStatsToAdmins(env: Env, code: string, stats: { participantCount: number; currentSlideResponseCount: number }): Promise<void> {
  await callDO(env, code, 'broadcastStats', { stats });
}

// Mirror the new `sessions` row into `presentation_sessions` so the legacy
// FK constraints from `participants`, `feedback_responses`, `default_responses`
// continue to resolve. The `id` is preserved across the two tables.
async function mirrorIntoLegacy(
  env: Env,
  id: string,
  eventId: string,
  sessionCode: string,
  status: string,
  currentSlideNumber: number | null,
  startedAt: string | null,
  endedAt: string | null,
  createdAt: string,
): Promise<void> {
  // Ensure a `presentations` row exists with the same id as the event so the
  // FK from `presentation_sessions.presentation_id` resolves. (The compat
  // layer uses eventId === presentationId, see eventService.eventIdFromPresentation.)
  await env.DB.prepare(
    `INSERT OR IGNORE INTO presentations (id, title, original_filename, r2_object_key, slide_count, created_at)
     VALUES (?, ?, '', '', 0, ?)`,
  )
    .bind(eventId, `Event ${eventId}`, createdAt)
    .run();

  await env.DB.prepare(
    `INSERT INTO presentation_sessions (id, presentation_id, session_code, status, current_slide_number, created_at, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       presentation_id = excluded.presentation_id,
       session_code    = excluded.session_code,
       status          = excluded.status,
       current_slide_number = excluded.current_slide_number,
       started_at      = excluded.started_at,
       ended_at        = excluded.ended_at`,
  )
    .bind(id, eventId, sessionCode, toLegacyStatus(status), currentSlideNumber, createdAt, startedAt, endedAt)
    .run();
}

async function loadSessionWithResolvedSlide(env: Env, code: string): Promise<{ joined: JoinedSession; session: SessionWithPresentation } | null> {
  const joined = await getJoinedSession(env, code);
  if (!joined) return null;
  const session = mapSession(joined);
  if (joined.current_slide_id) {
    const slide = await env.DB.prepare('SELECT slide_number FROM slides WHERE id = ?')
      .bind(joined.current_slide_id)
      .first<{ slide_number: number }>();
    session.currentSlideNumber = slide?.slide_number ?? null;
  }
  return { joined, session };
}

export async function getSession(env: Env, code: string): Promise<SessionWithPresentation | null> {
  const loaded = await loadSessionWithResolvedSlide(env, code);
  return loaded?.session ?? null;
}

export async function createSession(
  env: Env,
  presentationId: string,
  options: { createdBy?: string } = {},
): Promise<Result<SessionWithPresentation>> {
  const eventId = await eventIdFromPresentation(env, presentationId);
  if (!eventId) return err('PRESENTATION_NOT_FOUND', 404);

  const createdBy = options.createdBy ?? 'local-admin';
  const createdAt = now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateSessionCode();
    const id = newId();
    try {
      await env.DB.prepare(
        `INSERT INTO sessions (id, event_id, session_code, status, created_by, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
      )
        .bind(id, eventId, code, createdBy, createdAt)
        .run();
      await mirrorIntoLegacy(env, id, eventId, code, 'pending', null, null, null, createdAt);
      const loaded = await loadSessionWithResolvedSlide(env, code);
      if (!loaded) return err('NOT_FOUND', 500);
      return { ok: true, session: loaded.session };
    } catch (e) {
      if ((e as Error).message?.includes('UNIQUE')) continue;
      throw e;
    }
  }
  return err('CODE_GENERATION_FAILED', 500);
}

export async function startSession(env: Env, code: string): Promise<Result<SessionWithPresentation>> {
  const loaded = await loadSessionWithResolvedSlide(env, code);
  if (!loaded) return err('NOT_FOUND', 404);
  if (loaded.joined.status === 'ended') return err('SESSION_ENDED', 409);

  const slide = await slideService.getSlideByNumber(env, loaded.joined.presentation_id, 1);
  const payload = await composeSlidePayload(env, loaded.joined.presentation_id, slide, 1);
  const startedAt = loaded.joined.started_at ?? now();

  await env.DB.prepare(
    `UPDATE sessions SET status = 'live', current_slide_id = (SELECT id FROM slides WHERE presentation_id = ? AND slide_number = 1), started_at = ? WHERE id = ?`,
  )
    .bind(loaded.joined.presentation_id, startedAt, loaded.joined.id)
    .run();

  // Phase 4 — prime the DO with the current slide so participants that join
  // immediately receive SLIDE_CHANGED without an extra round-trip.
  const slideRow = await env.DB.prepare(
    'SELECT id FROM slides WHERE presentation_id = ? AND slide_number = 1',
  )
    .bind(loaded.joined.presentation_id)
    .first<{ id: string }>();
  if (slideRow) {
    await callDO(env, code, 'setCurrentSlide', { slideId: slideRow.id, slideNumber: 1 });
  }

  await mirrorIntoLegacy(
    env,
    loaded.joined.id,
    loaded.joined.event_id,
    loaded.joined.session_code,
    'live',
    1,
    startedAt,
    loaded.joined.ended_at,
    loaded.joined.created_at,
  );

  await notifyParticipants(env, code, payload);
  const after = await loadSessionWithResolvedSlide(env, code);
  return { ok: true, session: after!.session };
}

export async function changeSlide(
  env: Env,
  code: string,
  slideNumber: number,
): Promise<Result<SessionWithPresentation>> {
  const loaded = await loadSessionWithResolvedSlide(env, code);
  if (!loaded) return err('NOT_FOUND', 404);
  if (loaded.joined.status !== 'live' && loaded.joined.status !== 'paused') return err('SESSION_NOT_LIVE', 409);
  if (slideNumber < 1 || slideNumber > loaded.session.slideCount) return err('SLIDE_OUT_OF_RANGE', 400);

  const slide = await slideService.getSlideByNumber(env, loaded.joined.presentation_id, slideNumber);
  const payload = await composeSlidePayload(env, loaded.joined.presentation_id, slide, slideNumber);

  await env.DB.prepare(
    `UPDATE sessions SET current_slide_id = (SELECT id FROM slides WHERE presentation_id = ? AND slide_number = ?) WHERE id = ?`,
  )
    .bind(loaded.joined.presentation_id, slideNumber, loaded.joined.id)
    .run();

  await mirrorIntoLegacy(
    env,
    loaded.joined.id,
    loaded.joined.event_id,
    loaded.joined.session_code,
    loaded.joined.status,
    slideNumber,
    loaded.joined.started_at,
    loaded.joined.ended_at,
    loaded.joined.created_at,
  );

  await notifyParticipants(env, code, payload);
  const after = await loadSessionWithResolvedSlide(env, code);
  return { ok: true, session: after!.session };
}

export async function endSession(env: Env, code: string): Promise<Result<SessionWithPresentation>> {
  const loaded = await loadSessionWithResolvedSlide(env, code);
  if (!loaded) return err('NOT_FOUND', 404);
  if (loaded.joined.status === 'ended') return { ok: true, session: loaded.session };

  const endedAt = now();
  await env.DB.prepare(
    `UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?`,
  )
    .bind(endedAt, loaded.joined.id)
    .run();

  await mirrorIntoLegacy(
    env,
    loaded.joined.id,
    loaded.joined.event_id,
    loaded.joined.session_code,
    'ended',
    loaded.session.currentSlideNumber,
    loaded.joined.started_at,
    endedAt,
    loaded.joined.created_at,
  );

  await notifyParticipants(env, code, { type: 'SESSION_ENDED' });
  const after = await loadSessionWithResolvedSlide(env, code);
  return { ok: true, session: after!.session };
}

export async function currentSlideEvent(env: Env, code: string): Promise<Record<string, unknown> | null> {
  const loaded = await loadSessionWithResolvedSlide(env, code);
  if (!loaded) return null;
  if (loaded.session.currentSlideNumber == null) {
    return { type: 'NO_ACTIVE_SLIDE', status: loaded.session.status };
  }
  const slide = await slideService.getSlideByNumber(
    env,
    loaded.joined.presentation_id,
    loaded.session.currentSlideNumber,
  );
  return (await composeSlidePayload(env, loaded.joined.presentation_id, slide, loaded.session.currentSlideNumber)) as Record<
    string,
    unknown
  >;
}

export async function listSessions(env: Env, presentationId: string): Promise<SessionWithPresentation[]> {
  const eventId = await eventIdFromPresentation(env, presentationId);
  if (!eventId) return [];
  const { results } = await env.DB.prepare(
    `SELECT s.*, e.name AS presentation_title,
            COALESCE((SELECT pf.slide_count FROM presentation_files pf WHERE pf.event_id = s.event_id ORDER BY pf.uploaded_at DESC LIMIT 1), 0) AS slide_count,
            s.event_id AS presentation_id
     FROM sessions s
     JOIN events e ON e.id = s.event_id
     WHERE s.event_id = ?
     ORDER BY s.created_at DESC`,
  )
    .bind(eventId)
    .all();
  return (results as unknown as JoinedSession[]).map(mapSession);
}

async function countQuery(env: Env, sql: string, ...binds: (string | number)[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

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
  const loaded = await loadSessionWithResolvedSlide(env, code);
  if (!loaded) return null;

  const configured = await slideService.listSlides(env, loaded.joined.presentation_id);
  const byNum = new Map(configured.map((s) => [s.slideNumber, s]));
  const slides = Array.from({ length: loaded.session.slideCount }, (_, i) => {
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
    loaded.joined.id,
  );
  const responseCount = await countQuery(
    env,
    'SELECT COUNT(*) AS c FROM feedback_responses WHERE session_id = ?',
    loaded.joined.id,
  );
  let currentSlideResponseCount = 0;
  if (loaded.session.currentSlideNumber != null) {
    currentSlideResponseCount = await countQuery(
      env,
      `SELECT COUNT(*) AS c FROM feedback_responses fr
       JOIN slides s ON s.id = fr.slide_id
       WHERE fr.session_id = ? AND s.slide_number = ?`,
      loaded.joined.id,
      loaded.session.currentSlideNumber,
    );
  }

  return { session: loaded.session, slides, participantCount, responseCount, currentSlideResponseCount };
}

export async function broadcastStats(env: Env, code: string): Promise<void> {
  const loaded = await loadSessionWithResolvedSlide(env, code);
  if (!loaded) return;
  const participantCount = await countQuery(
    env,
    'SELECT COUNT(*) AS c FROM participants WHERE session_id = ?',
    loaded.joined.id,
  );
  let currentSlideResponseCount = 0;
  if (loaded.session.currentSlideNumber != null) {
    currentSlideResponseCount = await countQuery(
      env,
      `SELECT COUNT(*) AS c FROM feedback_responses fr
       JOIN slides s ON s.id = fr.slide_id
       WHERE fr.session_id = ? AND s.slide_number = ?`,
      loaded.joined.id,
      loaded.session.currentSlideNumber,
    );
  }
  await broadcastStatsToAdmins(env, code, { participantCount, currentSlideResponseCount });
}