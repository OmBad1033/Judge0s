import type { Env } from '../env';
import { newId, now } from '../utils/common';
import type { DefaultQuestionType } from '../validation/feedback';

export interface StoredDefaultQuestion {
  id: string;
  presentationId: string;
  questionText: string;
  questionType: DefaultQuestionType;
  targetSlides: number[];
  createdAt: string;
}

function mapRow(r: Record<string, unknown>): StoredDefaultQuestion {
  let targetSlides: number[] = [];
  try {
    const parsed = JSON.parse((r.target_slides as string) ?? '[]');
    if (Array.isArray(parsed)) targetSlides = parsed.filter((n) => Number.isInteger(n));
  } catch {
    targetSlides = [];
  }
  return {
    id: r.id as string,
    presentationId: r.presentation_id as string,
    questionText: r.question_text as string,
    questionType: r.question_type as DefaultQuestionType,
    targetSlides,
    createdAt: r.created_at as string,
  };
}

export async function listDefaultQuestions(env: Env, presentationId: string): Promise<StoredDefaultQuestion[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, presentation_id, question_text, question_type, target_slides, created_at FROM default_questions WHERE presentation_id = ? ORDER BY created_at',
  )
    .bind(presentationId)
    .all();
  return (results as Record<string, unknown>[]).map(mapRow);
}

export async function getDefaultQuestionsForSlide(
  env: Env,
  presentationId: string,
  slideNumber: number,
): Promise<StoredDefaultQuestion[]> {
  const all = await listDefaultQuestions(env, presentationId);
  return all.filter((q) => q.targetSlides.includes(slideNumber));
}

export async function getDefaultQuestionById(
  env: Env,
  questionId: string,
): Promise<StoredDefaultQuestion | null> {
  const row = await env.DB.prepare(
    'SELECT id, presentation_id, question_text, question_type, target_slides, created_at FROM default_questions WHERE id = ?',
  )
    .bind(questionId)
    .first();
  return row ? mapRow(row) : null;
}

export async function createDefaultQuestion(
  env: Env,
  presentationId: string,
  data: { questionText: string; questionType: DefaultQuestionType; targetSlides: number[] },
): Promise<StoredDefaultQuestion> {
  const id = newId();
  const createdAt = now();
  await env.DB.prepare(
    'INSERT INTO default_questions (id, presentation_id, question_text, question_type, target_slides, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, presentationId, data.questionText, data.questionType, JSON.stringify(data.targetSlides), createdAt)
    .run();
  return {
    id,
    presentationId,
    questionText: data.questionText,
    questionType: data.questionType,
    targetSlides: data.targetSlides,
    createdAt,
  };
}

export async function deleteDefaultQuestion(env: Env, presentationId: string, questionId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    'DELETE FROM default_questions WHERE id = ? AND presentation_id = ?',
  )
    .bind(questionId, presentationId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
