import { z } from 'zod';

export const FEEDBACK_TYPES = ['disabled', 'boolean', 'multiple_choice', 'open_text'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

// Phase 3 — new field-type enum used by the form builder.
export const FIELD_TYPES = [
  'boolean',
  'single_select',
  'multi_select',
  'rating',
  'nps',
  'text',
  'textarea',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const fieldTypeSchema = z.enum(FIELD_TYPES);

export const feedbackFieldConfigSchema = z.object({
  fieldType: fieldTypeSchema,
  label: z.string().min(1),
  options: z.array(z.string()).optional(),
  isRequired: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});
export type FeedbackFieldConfig = z.infer<typeof feedbackFieldConfigSchema>;

export const feedbackFieldsArraySchema = z.array(feedbackFieldConfigSchema).max(20);

export const MAX_OPEN_TEXT_LENGTH = 2000;

export const feedbackRuleConfigSchema = z.object({
  enabled: z.boolean(),
  required: z.boolean(),
  feedbackType: z.enum(FEEDBACK_TYPES),
  question: z.string().optional(),
  options: z.array(z.string()).optional(),
  allowResubmission: z.boolean(),
}).superRefine((val, ctx) => {
  if (val.feedbackType === 'multiple_choice') {
    const opts = val.options ?? [];
    if (opts.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'At least one option is required for multiple_choice',
      });
    }
    if (opts.some((o) => o.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Options must be non-empty',
      });
    }
  }
});

export type FeedbackRuleConfig = z.infer<typeof feedbackRuleConfigSchema>;

export interface StoredFeedbackRule {
  enabled: boolean;
  required: boolean;
  feedbackType: FeedbackType;
  question: string | null;
  options: string[] | null;
  allowResubmission: boolean;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  value?: string | null;
}

export function isFeedbackEnabled(rule: { enabled: boolean; feedbackType: FeedbackType }): boolean {
  return rule.enabled && rule.feedbackType !== 'disabled';
}

export const DEFAULT_QUESTION_TYPES = ['interested', 'rating'] as const;
export type DefaultQuestionType = (typeof DEFAULT_QUESTION_TYPES)[number];

export function validateDefaultResponse(
  questionType: DefaultQuestionType,
  rawValue: unknown,
): ValidationResult {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value.length === 0) return { ok: false, error: 'RESPONSE_REQUIRED' };
  switch (questionType) {
    case 'interested':
      if (!['interested', 'not_interested'].includes(value)) return { ok: false, error: 'INVALID_CHOICE' };
      return { ok: true, value };
    case 'rating': {
      if (!/^\d+$/.test(value)) return { ok: false, error: 'INVALID_RATING' };
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 10) return { ok: false, error: 'INVALID_RATING' };
      return { ok: true, value };
    }
    default:
      return { ok: false, error: 'FEEDBACK_DISABLED' };
  }
}

export function validateResponse(rule: StoredFeedbackRule, rawValue: unknown): ValidationResult {
  if (!isFeedbackEnabled(rule)) {
    return { ok: false, error: 'FEEDBACK_DISABLED' };
  }

  const value = typeof rawValue === 'string' ? rawValue.trim() : '';

  if (value.length === 0) {
    if (rule.required) return { ok: false, error: 'RESPONSE_REQUIRED' };
    return { ok: true, value: null };
  }

  switch (rule.feedbackType) {
    case 'boolean':
      if (!['yes', 'no'].includes(value)) return { ok: false, error: 'INVALID_BOOLEAN' };
      return { ok: true, value };
    case 'multiple_choice':
      if (!(rule.options ?? []).includes(value)) return { ok: false, error: 'INVALID_CHOICE' };
      return { ok: true, value };
    case 'open_text':
      if (value.length > MAX_OPEN_TEXT_LENGTH) return { ok: false, error: 'RESPONSE_TOO_LONG' };
      return { ok: true, value };
    default:
      return { ok: false, error: 'FEEDBACK_DISABLED' };
  }
}

/**
 * Validate a response against a Phase 3 `FeedbackField` (multi_select, rating,
 * nps, boolean, single_select, text/textarea). The legacy `validateResponse`
 * only understands the 4 legacy types, so this is the entry point used by the
 * full form-builder path. Non-string types are serialized to JSON in
 * `response_value`:
 *   multi_select → JSON.stringify([...selected])
 *   rating/nps   → JSON.stringify(number)
 * boolean/single_select/text stay plain strings (backwards compatible).
 */
export function validateFieldResponse(
  field: {
    fieldType: FieldType;
    label: string;
    options: string[] | null;
    isRequired: boolean;
    config: Record<string, unknown>;
  },
  rawValue: unknown,
): ValidationResult {
  const empty = rawValue === null || rawValue === undefined || rawValue === '';
  if (empty) {
    if (field.isRequired) return { ok: false, error: 'RESPONSE_REQUIRED' };
    return { ok: true, value: null };
  }

  const toNum = (v: unknown): number | null => {
    const s = typeof v === 'string' ? v.trim() : v;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  switch (field.fieldType) {
    case 'boolean': {
      const v = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
      if (!['yes', 'no'].includes(v)) return { ok: false, error: 'INVALID_BOOLEAN' };
      return { ok: true, value: v };
    }
    case 'single_select': {
      const v = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (!(field.options ?? []).includes(v)) return { ok: false, error: 'INVALID_CHOICE' };
      return { ok: true, value: v };
    }
    case 'multi_select': {
      let arr: unknown[] = [];
      if (Array.isArray(rawValue)) arr = rawValue;
      else if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        try {
          const parsed: unknown = JSON.parse(trimmed);
          arr = Array.isArray(parsed) ? parsed : [];
        } catch {
          arr = trimmed.length > 0 ? [trimmed] : [];
        }
      }
      if (arr.length === 0) {
        if (field.isRequired) return { ok: false, error: 'RESPONSE_REQUIRED' };
        return { ok: true, value: null };
      }
      const opts = field.options ?? [];
      const selected: string[] = [];
      for (const item of arr) {
        const s = String(item).trim();
        if (!opts.includes(s)) return { ok: false, error: 'INVALID_CHOICE' };
        if (!selected.includes(s)) selected.push(s);
      }
      return { ok: true, value: JSON.stringify(selected) };
    }
    case 'rating':
    case 'nps': {
      const n = toNum(rawValue);
      if (n === null || !Number.isInteger(n)) return { ok: false, error: 'INVALID_RATING' };
      const min = typeof field.config.min === 'number' ? field.config.min : 0;
      const max = typeof field.config.max === 'number' ? field.config.max : 10;
      if (n < min || n > max) return { ok: false, error: 'INVALID_RATING' };
      return { ok: true, value: JSON.stringify(n) };
    }
    case 'text':
    case 'textarea': {
      const v = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (v.length > MAX_OPEN_TEXT_LENGTH) return { ok: false, error: 'RESPONSE_TOO_LONG' };
      return { ok: true, value: v };
    }
    default:
      return { ok: false, error: 'FEEDBACK_DISABLED' };
  }
}
