import type { Env } from '../env';
import { newId, now } from '../utils/common';
import type { StoredFeedbackRule, FeedbackRuleConfig } from '../validation/feedback';

export interface Slide {
  id: string;
  presentationId: string;
  slideNumber: number;
  title: string | null;
  summary: string;
  createdAt: string;
  feedbackRule: StoredFeedbackRule | null;
}

function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1' || v === 'true';
}

function mapSlide(r: Record<string, unknown>): Slide {
  let options: string[] | null = null;
  if (r.options_json) {
    try {
      options = JSON.parse(r.options_json as string) as string[];
    } catch {
      options = null;
    }
  }
  const hasRule = r.feedback_type !== undefined && r.feedback_type !== null;
  return {
    id: r.id as string,
    presentationId: r.presentation_id as string,
    slideNumber: r.slide_number as number,
    title: (r.title as string) ?? null,
    summary: r.summary as string,
    createdAt: r.created_at as string,
    feedbackRule: hasRule
      ? {
          enabled: toBool(r.enabled),
          required: toBool(r.required),
          feedbackType: r.feedback_type as StoredFeedbackRule['feedbackType'],
          question: (r.question as string) ?? null,
          options,
          allowResubmission: toBool(r.allow_resubmission),
        }
      : null,
  };
}

const SLIDE_COLUMNS =
  's.id, s.presentation_id, s.slide_number, s.title, s.summary, s.created_at, ' +
  'r.enabled, r.required, r.feedback_type, r.question, r.options_json, r.allow_resubmission';

export async function upsertSlide(
  env: Env,
  presentationId: string,
  slideNumber: number,
  data: { title?: string; summary: string; feedbackRule: FeedbackRuleConfig },
): Promise<Slide> {
  const slideRow = await env.DB.prepare(
    `INSERT INTO slides (id, presentation_id, slide_number, title, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(presentation_id, slide_number) DO UPDATE SET
       title = excluded.title,
       summary = excluded.summary
     RETURNING id`,
  )
    .bind(newId(), presentationId, slideNumber, data.title ?? null, data.summary, now())
    .first<{ id: string }>();

  const slideId = slideRow!.id;
  const rule = data.feedbackRule;
  await env.DB.prepare(
    `INSERT INTO feedback_rules (id, slide_id, enabled, required, feedback_type, question, options_json, allow_resubmission)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slide_id) DO UPDATE SET
       enabled = excluded.enabled,
       required = excluded.required,
       feedback_type = excluded.feedback_type,
       question = excluded.question,
       options_json = excluded.options_json,
       allow_resubmission = excluded.allow_resubmission`,
  )
    .bind(
      newId(),
      slideId,
      rule.enabled ? 1 : 0,
      rule.required ? 1 : 0,
      rule.feedbackType,
      rule.question ?? null,
      rule.options ? JSON.stringify(rule.options) : null,
      rule.allowResubmission ? 1 : 0,
    )
    .run();

  const row = await env.DB.prepare(
    `SELECT ${SLIDE_COLUMNS} FROM slides s LEFT JOIN feedback_rules r ON r.slide_id = s.id WHERE s.id = ?`,
  )
    .bind(slideId)
    .first();
  return mapSlide(row!);
}

export async function listSlides(env: Env, presentationId: string): Promise<Slide[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${SLIDE_COLUMNS} FROM slides s
     LEFT JOIN feedback_rules r ON r.slide_id = s.id
     WHERE s.presentation_id = ?
     ORDER BY s.slide_number`,
  )
    .bind(presentationId)
    .all();
  return (results as Record<string, unknown>[]).map(mapSlide);
}

export async function getSlideByNumber(
  env: Env,
  presentationId: string,
  slideNumber: number,
): Promise<Slide | null> {
  const row = await env.DB.prepare(
    `SELECT ${SLIDE_COLUMNS} FROM slides s
     LEFT JOIN feedback_rules r ON r.slide_id = s.id
     WHERE s.presentation_id = ? AND s.slide_number = ?`,
  )
    .bind(presentationId, slideNumber)
    .first();
  return row ? mapSlide(row) : null;
}
