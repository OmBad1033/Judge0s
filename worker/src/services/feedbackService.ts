import type { Env } from '../env';
import { newId, now } from '../utils/common';
import * as sessionService from './sessionService';
import * as slideService from './slideService';
import * as participantService from './participantService';
import { validateResponse, type StoredFeedbackRule } from '../validation/feedback';

export interface StoredResponse {
  id: string;
  slideNumber: number;
  feedbackType: string;
  question: string | null;
  responseValue: string | null;
  submittedAt: string;
}

type Result =
  | { ok: true; data: StoredResponse }
  | { ok: false; error: string; status: 400 | 404 | 409 };

const err = (error: string, status: 400 | 404 | 409) => ({ ok: false, error, status }) as const;

const disabledRule: StoredFeedbackRule = {
  enabled: false,
  required: false,
  feedbackType: 'disabled',
  question: null,
  options: null,
  allowResubmission: false,
};

export async function submitFeedback(
  env: Env,
  code: string,
  participantId: string,
  slideNumber: number,
  rawResponse: unknown,
): Promise<Result> {
  const session = await sessionService.getSession(env, code);
  if (!session) return err('NOT_FOUND', 404);
  if (session.status !== 'live') return err('SESSION_NOT_LIVE', 409);

  const participant = await participantService.getParticipant(env, participantId);
  if (!participant || participant.sessionId !== session.id) {
    return err('PARTICIPANT_NOT_FOUND', 404);
  }
  if (session.currentSlideNumber !== slideNumber) return err('NOT_CURRENT_SLIDE', 409);

  const slide = await slideService.getSlideByNumber(env, session.presentationId, slideNumber);
  if (!slide) return err('SLIDE_NOT_FOUND', 404);
  const rule = slide.feedbackRule ?? disabledRule;

  const vr = validateResponse(rule, rawResponse);
  if (!vr.ok) return err(vr.error!, 400);

  const existing = await env.DB.prepare(
    'SELECT id FROM feedback_responses WHERE participant_id = ? AND slide_id = ?',
  )
    .bind(participant.id, slide.id)
    .first<{ id: string }>();

  const submittedAt = now();
  const value = vr.value ?? null;

  let responseId: string;
  if (existing) {
    if (!rule.allowResubmission) return err('RESUBMISSION_NOT_ALLOWED', 409);
    await env.DB.prepare(
      'UPDATE feedback_responses SET feedback_type = ?, question = ?, response_value = ?, submitted_at = ? WHERE id = ?',
    )
      .bind(rule.feedbackType, rule.question, value, submittedAt, existing.id)
      .run();
    responseId = existing.id;
  } else {
    const inserted = await env.DB.prepare(
      `INSERT INTO feedback_responses (id, session_id, participant_id, slide_id, feedback_type, question, response_value, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
      .bind(newId(), session.id, participant.id, slide.id, rule.feedbackType, rule.question, value, submittedAt)
      .first<{ id: string }>();
    responseId = inserted!.id;
  }

  // P2 §4.2 — notify live admin clients of updated response counts.
  await sessionService.broadcastStats(env, code);

  return {
    ok: true,
    data: {
      id: responseId,
      slideNumber,
      feedbackType: rule.feedbackType,
      question: rule.question,
      responseValue: value,
      submittedAt,
    },
  };
}

export async function getMyFeedback(
  env: Env,
  code: string,
  participantId: string,
): Promise<StoredResponse[] | null> {
  const session = await sessionService.getSession(env, code);
  if (!session) return null;
  const participant = await participantService.getParticipant(env, participantId);
  if (!participant || participant.sessionId !== session.id) return null;

  const { results } = await env.DB.prepare(
    `SELECT fr.id, s.slide_number AS slide_number, fr.feedback_type, fr.question, fr.response_value, fr.submitted_at
     FROM feedback_responses fr
     JOIN slides s ON s.id = fr.slide_id
     WHERE fr.participant_id = ?
     ORDER BY s.slide_number`,
  )
    .bind(participant.id)
    .all();

  return (results as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    slideNumber: r.slide_number as number,
    feedbackType: r.feedback_type as string,
    question: (r.question as string) ?? null,
    responseValue: (r.response_value as string) ?? null,
    submittedAt: r.submitted_at as string,
  }));
}
