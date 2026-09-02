// AI Slide Config — Phase 3. Approval workflow.
//
// Approving a suggestion writes through the SAME code path an admin uses when
// configuring a slide manually (slideService.replaceSlideFields + a slides
// UPDATE), so the resulting rows are byte-identical to hand-building them.
// Participant-facing queries only ever join `feedback_fields`, never
// `ai_field_suggestions`, so unapproved suggestions can't leak to a live view.

import type { Env } from '../env';
import { now } from '../utils/common';
import * as slideService from './slideService';
import { aiFieldSuggestionSchema } from '../validation/ai';
import { logAdminAction } from './auditService';

export type ApprovalResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export interface ApproveOptions {
  actorId: string;
  actorKind: 'user' | 'admin_cookie';
  // Optional admin overrides applied on top of the suggestion before commit.
  title?: string;
  summary?: string;
  // Optional inline comment recorded in audit (informational).
  comment?: string;
}

/**
 * Approve the pending suggestion for one slide. Applies:
 *   - suggested_title / suggested_summary → slides.title / slides.summary
 *   - suggested fields → feedback_fields via replaceSlideFields (same write
 *     path as PUT /api/events/:id/slides/:slideId/fields)
 *
 * An admin override (opts.title / opts.summary) wins over the suggestion;
 * a suggestion value only replaces the current row when the admin didn't
 * type a value of their own already.
 */
export async function approveSlideSuggestion(
  env: Env,
  eventId: string,
  slideId: string,
  opts: ApproveOptions,
): Promise<ApprovalResult> {
  const slide = await env.DB.prepare(
    'SELECT id, slide_number, title, summary FROM slides WHERE id = ? AND presentation_id = ?',
  )
    .bind(slideId, eventId)
    .first<{ id: string; slide_number: number; title: string | null; summary: string | null }>();
  if (!slide) return { ok: false, error: 'SLIDE_NOT_FOUND', status: 404 };

  const sugg = await env.DB.prepare(
    `SELECT suggested_title, suggested_summary FROM ai_slide_suggestions WHERE slide_id = ?`,
  )
    .bind(slideId)
    .first<{ suggested_title: string | null; suggested_summary: string | null }>();
  if (!sugg) return { ok: false, error: 'NO_SUGGESTION', status: 404 };

  // Re-validate every stored field suggestion at the boundary before it can
  // reach feedback_fields (defense in depth against stale/bad rows).
  const safeFields: Array<{
    fieldType: slideService.FeedbackField['fieldType'];
    label: string;
    options?: string[];
    isRequired?: boolean;
  }> = [];
  const fieldRows = await env.DB.prepare(
    `SELECT id, order_index, field_type, label, options_json, is_required
     FROM ai_field_suggestions WHERE slide_id = ? ORDER BY order_index`,
  )
    .bind(slideId)
    .all<{
      field_type: string;
      label: string;
      options_json: string | null;
      is_required: number | null;
    }>();
  for (const f of fieldRows.results) {
    let options: string[] | undefined;
    if (f.options_json) {
      try {
        const parsed: unknown = JSON.parse(f.options_json);
        if (Array.isArray(parsed)) options = parsed.map((x) => String(x));
      } catch {
        options = undefined;
      }
    }
    const parsed = aiFieldSuggestionSchema.safeParse({
      fieldType: f.field_type,
      label: f.label,
      options,
      isRequired: f.is_required === 1,
    });
    if (parsed.success) {
      safeFields.push({
        fieldType: parsed.data.fieldType,
        label: parsed.data.label,
        options: parsed.data.options,
        isRequired: parsed.data.isRequired,
      });
    }
  }

  const finalTitle = opts.title ?? sugg.suggested_title ?? slide.title;
  const finalSummary = opts.summary ?? sugg.suggested_summary ?? slide.summary ?? '';

  // Write through the existing slideService path.
  await env.DB.prepare('UPDATE slides SET title = ?, summary = ? WHERE id = ?')
    .bind(finalTitle, finalSummary, slideId)
    .run();
  if (safeFields.length > 0) {
    await slideService.replaceSlideFields(env, slideId, safeFields);
  }

  // Mark the suggestion approved.
  const ts = now();
  await env.DB.prepare(
    `UPDATE ai_slide_suggestions SET status = 'approved', created_at = ? WHERE slide_id = ?`,
  )
    .bind(ts, slideId)
    .run();
  await env.DB.prepare(`UPDATE ai_field_suggestions SET status = 'approved' WHERE slide_id = ?`)
    .bind(slideId)
    .run();

  await logAdminAction(env, {
    actorId: opts.actorId,
    actorKind: opts.actorKind,
    action: 'ai_suggestion.approve',
    target: `slide:${slideId}`,
    metadata: { slideNumber: slide.slide_number, comment: opts.comment ?? null },
  });

  return { ok: true };
}

export async function rejectSlideSuggestion(
  env: Env,
  eventId: string,
  slideId: string,
  opts: { actorId: string; actorKind: 'user' | 'admin_cookie'; comment?: string },
): Promise<ApprovalResult> {
  const slide = await env.DB.prepare('SELECT slide_number FROM slides WHERE id = ? AND presentation_id = ?')
    .bind(slideId, eventId)
    .first<{ slide_number: number }>();
  if (!slide) return { ok: false, error: 'SLIDE_NOT_FOUND', status: 404 };

  const ts = now();
  await env.DB.prepare(`UPDATE ai_slide_suggestions SET status = 'rejected', created_at = ? WHERE slide_id = ?`)
    .bind(ts, slideId)
    .run();
  await env.DB.prepare(`UPDATE ai_field_suggestions SET status = 'rejected' WHERE slide_id = ?`)
    .bind(slideId)
    .run();

  await logAdminAction(env, {
    actorId: opts.actorId,
    actorKind: opts.actorKind,
    action: 'ai_suggestion.reject',
    target: `slide:${slideId}`,
    metadata: { slideNumber: slide.slide_number, comment: opts.comment ?? null },
  });

  return { ok: true };
}
