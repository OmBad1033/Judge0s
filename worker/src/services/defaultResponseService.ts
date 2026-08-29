import type { Env } from '../env';
import { newId, now } from '../utils/common';
import * as sessionService from './sessionService';
import * as participantService from './participantService';
import { getDefaultQuestionById } from './defaultQuestionService';
import { validateDefaultResponse } from '../validation/feedback';

export interface StoredDefaultResponse {
  id: string;
  slideNumber: number;
  defaultQuestionId: string;
  questionType: string;
  questionText: string;
  responseValue: string | null;
  submittedAt: string;
}

type Result =
  | { ok: true; data: StoredDefaultResponse }
  | { ok: false; error: string; status: 400 | 404 | 409 };

const err = (error: string, status: 400 | 404 | 409) => ({ ok: false, error, status }) as const;

export async function submitDefaultResponse(
  env: Env,
  code: string,
  participantId: string,
  defaultQuestionId: string,
  slideNumber: number,
  rawResponse: unknown,
): Promise<Result> {
  const session = await sessionService.getSession(env, code);
  if (!session) return err('NOT_FOUND', 404);
  if (session.status !== 'live') return err('SESSION_NOT_LIVE', 409);

  const participant = await participantService.getParticipant(env, participantId);
  if (!participant || participant.sessionId !== session.id) return err('PARTICIPANT_NOT_FOUND', 404);
  if (session.currentSlideNumber !== slideNumber) return err('NOT_CURRENT_SLIDE', 409);

  const question = await getDefaultQuestionById(env, defaultQuestionId);
  if (!question || question.presentationId !== session.presentationId) return err('NOT_FOUND', 404);
  if (!question.targetSlides.includes(slideNumber)) return err('SLIDE_OUT_OF_RANGE', 400);

  const vr = validateDefaultResponse(question.questionType, rawResponse);
  if (!vr.ok) return err(vr.error!, 400);

  const value = vr.value ?? null;
  const submittedAt = now();

  const existing = await env.DB.prepare(
    'SELECT id FROM default_responses WHERE participant_id = ? AND default_question_id = ? AND slide_number = ?',
  )
    .bind(participant.id, question.id, slideNumber)
    .first<{ id: string }>();

  let responseId: string;
  if (existing) {
    await env.DB.prepare(
      'UPDATE default_responses SET response_value = ?, submitted_at = ? WHERE id = ?',
    )
      .bind(value, submittedAt, existing.id)
      .run();
    responseId = existing.id;
  } else {
    const inserted = await env.DB.prepare(
      `INSERT INTO default_responses (id, session_id, participant_id, default_question_id, slide_number, response_value, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
      .bind(newId(), session.id, participant.id, question.id, slideNumber, value, submittedAt)
      .first<{ id: string }>();
    responseId = inserted!.id;
  }

  // Notify live admin clients of updated counts.
  await sessionService.broadcastStats(env, code);

  return {
    ok: true,
    data: {
      id: responseId,
      slideNumber,
      defaultQuestionId: question.id,
      questionType: question.questionType,
      questionText: question.questionText,
      responseValue: value,
      submittedAt,
    },
  };
}

export async function getMyDefaultFeedback(
  env: Env,
  code: string,
  participantId: string,
): Promise<StoredDefaultResponse[] | null> {
  const session = await sessionService.getSession(env, code);
  if (!session) return null;
  const participant = await participantService.getParticipant(env, participantId);
  if (!participant || participant.sessionId !== session.id) return null;

  const { results } = await env.DB.prepare(
    `SELECT dr.id, dr.default_question_id AS default_question_id, dr.slide_number, dq.question_type AS question_type,
            dq.question_text AS question_text, dr.response_value AS response_value, dr.submitted_at AS submitted_at
     FROM default_responses dr
     JOIN default_questions dq ON dq.id = dr.default_question_id
     WHERE dr.participant_id = ?
     ORDER BY dr.slide_number, dq.created_at`,
  )
    .bind(participant.id)
    .all();

  return (results as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    slideNumber: r.slide_number as number,
    defaultQuestionId: r.default_question_id as string,
    questionType: r.question_type as string,
    questionText: r.question_text as string,
    responseValue: (r.response_value as string) ?? null,
    submittedAt: r.submitted_at as string,
  }));
}
