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

// Phase 3 — new field row.
export interface FeedbackField {
  id: string;
  slideId: string;
  orderIndex: number;
  fieldType: 'boolean' | 'single_select' | 'multi_select' | 'rating' | 'nps' | 'text' | 'textarea';
  label: string;
  options: string[] | null;
  isRequired: boolean;
  config: Record<string, unknown>;
}

function mapField(r: Record<string, unknown>): FeedbackField {
  let options: string[] | null = null;
  if (r.options_json) {
    try {
      options = JSON.parse(r.options_json as string) as string[];
    } catch {
      options = null;
    }
  }
  let config: Record<string, unknown> = {};
  if (r.config_json) {
    try {
      config = JSON.parse(r.config_json as string) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }
  return {
    id: r.id as string,
    slideId: r.slide_id as string,
    orderIndex: r.order_index as number,
    fieldType: r.field_type as FeedbackField['fieldType'],
    label: r.label as string,
    options,
    isRequired: toBool(r.is_required),
    config,
  };
}

// Build the legacy `feedbackRule` shape from the first feedback_field for the
// slide. The compat layer uses this for the existing frontend.
function ruleFromField(field: FeedbackField | null): StoredFeedbackRule | null {
  if (!field) return null;
  const allowResubmission = field.config.allowResubmission === true;
  // Map field_type back to the legacy 4-type enum for the wire shape.
  let feedbackType: StoredFeedbackRule['feedbackType'] = 'disabled';
  switch (field.fieldType) {
    case 'boolean':       feedbackType = 'boolean'; break;
    case 'single_select': feedbackType = 'multiple_choice'; break;
    case 'text':
    case 'textarea':      feedbackType = 'open_text'; break;
    case 'rating':
    case 'nps':
    case 'multi_select':
      // These don't have a legacy equivalent; fall back to disabled on the
      // legacy wire shape. New clients use the new model.
      feedbackType = 'disabled';
      break;
  }
  return {
    enabled: true,
    required: field.isRequired,
    feedbackType,
    question: field.label,
    options: field.options,
    allowResubmission,
  };
}

interface SlideRow extends Record<string, unknown> {
  id: string;
  presentation_id: string;
  slide_number: number;
  title: string | null;
  summary: string;
  created_at: string;
  field_id: string | null;
  field_type: string | null;
  field_label: string | null;
  field_options_json: string | null;
  field_is_required: number | null;
  field_config_json: string | null;
  field_order_index: number | null;
}

function mapSlide(r: SlideRow): Slide {
  const field =
    r.field_id != null
      ? mapField({
          id: r.field_id,
          slide_id: r.id,
          order_index: r.field_order_index ?? 0,
          field_type: r.field_type,
          label: r.field_label,
          options_json: r.field_options_json,
          is_required: r.field_is_required,
          config_json: r.field_config_json,
        })
      : null;
  return {
    id: r.id as string,
    presentationId: r.presentation_id,
    slideNumber: r.slide_number,
    title: r.title ?? null,
    summary: r.summary,
    createdAt: r.created_at,
    feedbackRule: ruleFromField(field),
  };
}

const SLIDE_COLUMNS = `
  s.id, s.presentation_id, s.slide_number, s.title, s.summary, s.created_at,
  f.id AS field_id, f.field_type AS field_type, f.label AS field_label,
  f.options_json AS field_options_json, f.is_required AS field_is_required,
  f.config_json AS field_config_json, f.order_index AS field_order_index
`;

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
  // Replace the field set for this slide with a single field representing the
  // legacy feedbackRule. The new PUT /api/events/:id/slides/:slideId/fields
  // path replaces this with the richer form.
  await env.DB.prepare('DELETE FROM feedback_fields WHERE slide_id = ?').bind(slideId).run();

  if (rule.enabled && rule.feedbackType !== 'disabled') {
    let fieldType: FeedbackField['fieldType'] = 'text';
    switch (rule.feedbackType) {
      case 'boolean':         fieldType = 'boolean'; break;
      case 'multiple_choice': fieldType = 'single_select'; break;
      case 'open_text':       fieldType = 'text'; break;
    }
    await env.DB.prepare(
      `INSERT INTO feedback_fields (id, slide_id, order_index, field_type, label, options_json, is_required, config_json)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId(),
        slideId,
        fieldType,
        rule.question ?? 'Your feedback',
        rule.options ? JSON.stringify(rule.options) : null,
        rule.required ? 1 : 0,
        JSON.stringify({ allowResubmission: rule.allowResubmission }),
      )
      .run();
  }

  const row = await env.DB.prepare(
    `SELECT ${SLIDE_COLUMNS} FROM slides s
     LEFT JOIN feedback_fields f ON f.slide_id = s.id
     WHERE s.id = ?
     ORDER BY f.order_index
     LIMIT 1`,
  )
    .bind(slideId)
    .first<SlideRow>();
  return mapSlide(row!);
}

export async function listSlides(env: Env, presentationId: string): Promise<Slide[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${SLIDE_COLUMNS} FROM slides s
     LEFT JOIN feedback_fields f ON f.slide_id = s.id
     WHERE s.presentation_id = ?
     ORDER BY s.slide_number, f.order_index`,
  )
    .bind(presentationId)
    .all<SlideRow>();
  return results.map(mapSlide);
}

export async function getSlideByNumber(
  env: Env,
  presentationId: string,
  slideNumber: number,
): Promise<Slide | null> {
  const row = await env.DB.prepare(
    `SELECT ${SLIDE_COLUMNS} FROM slides s
     LEFT JOIN feedback_fields f ON f.slide_id = s.id
     WHERE s.presentation_id = ? AND s.slide_number = ?
     ORDER BY f.order_index
     LIMIT 1`,
  )
    .bind(presentationId, slideNumber)
    .first<SlideRow>();
  return row ? mapSlide(row) : null;
}

// Phase 3 — new form-builder API.
export async function replaceSlideFields(
  env: Env,
  slideId: string,
  fields: Array<{
    fieldType: FeedbackField['fieldType'];
    label: string;
    options?: string[];
    isRequired?: boolean;
    config?: Record<string, unknown>;
  }>,
): Promise<FeedbackField[]> {
  await env.DB.prepare('DELETE FROM feedback_fields WHERE slide_id = ?').bind(slideId).run();
  const inserted: FeedbackField[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const id = newId();
    await env.DB.prepare(
      `INSERT INTO feedback_fields (id, slide_id, order_index, field_type, label, options_json, is_required, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        slideId,
        i,
        f.fieldType,
        f.label,
        f.options ? JSON.stringify(f.options) : null,
        f.isRequired ? 1 : 0,
        f.config ? JSON.stringify(f.config) : null,
      )
      .run();
    inserted.push({
      id,
      slideId,
      orderIndex: i,
      fieldType: f.fieldType,
      label: f.label,
      options: f.options ?? null,
      isRequired: !!f.isRequired,
      config: f.config ?? {},
    });
  }
  return inserted;
}