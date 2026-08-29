import type { Env } from '../env';
import * as sessionService from './sessionService';
import * as defaultQuestionService from './defaultQuestionService';

export interface ExportData {
  session: { code: string; presentation: string; status: string };
  feedback: {
    slideNumber: number;
    user: { name: string; email: string };
    question: string | null;
    feedbackType: string;
    response: string | null;
    submittedAt: string;
  }[];
  defaultQuestions: {
    id: string;
    questionText: string;
    questionType: string;
    targetSlides: number[];
  }[];
  defaultFeedback: {
    slideNumber: number;
    user: { name: string; email: string };
    question: string;
    questionType: string;
    response: string | null;
    submittedAt: string;
  }[];
}

export async function exportSession(env: Env, code: string): Promise<ExportData | null> {
  const session = await sessionService.getSession(env, code);
  if (!session) return null;

  const { results } = await env.DB.prepare(
    `SELECT s.slide_number AS slide_number, p.name AS name, p.email AS email,
            fr.question AS question, fr.feedback_type AS feedback_type,
            fr.response_value AS response_value, fr.submitted_at AS submitted_at
     FROM feedback_responses fr
     JOIN slides s ON s.id = fr.slide_id
     JOIN participants p ON p.id = fr.participant_id
     WHERE fr.session_id = ?
     ORDER BY s.slide_number, p.email`,
  )
    .bind(session.id)
    .all();

  const feedback = (results as Record<string, unknown>[]).map((r) => ({
    slideNumber: r.slide_number as number,
    user: { name: r.name as string, email: r.email as string },
    question: (r.question as string) ?? null,
    feedbackType: r.feedback_type as string,
    response: (r.response_value as string) ?? null,
    submittedAt: r.submitted_at as string,
  }));

  const defaultQuestions = (await defaultQuestionService.listDefaultQuestions(env, session.presentationId)).map(
    (q) => ({
      id: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      targetSlides: q.targetSlides,
    }),
  );

  const { results: drRows } = await env.DB.prepare(
    `SELECT dr.slide_number AS slide_number, p.name AS name, p.email AS email,
            dq.question_text AS question, dq.question_type AS question_type,
            dr.response_value AS response_value, dr.submitted_at AS submitted_at
     FROM default_responses dr
     JOIN participants p ON p.id = dr.participant_id
     JOIN default_questions dq ON dq.id = dr.default_question_id
     WHERE dr.session_id = ?
     ORDER BY dr.slide_number, p.email, dq.created_at`,
  )
    .bind(session.id)
    .all();

  const defaultFeedback = (drRows as Record<string, unknown>[]).map((r) => ({
    slideNumber: r.slide_number as number,
    user: { name: r.name as string, email: r.email as string },
    question: r.question as string,
    questionType: r.question_type as string,
    response: (r.response_value as string) ?? null,
    submittedAt: r.submitted_at as string,
  }));

  return {
    session: {
      code: session.sessionCode,
      presentation: session.presentationTitle,
      status: session.status,
    },
    feedback,
    defaultQuestions,
    defaultFeedback,
  };
}
