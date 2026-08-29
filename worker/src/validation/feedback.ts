import { z } from 'zod';

export const FEEDBACK_TYPES = ['disabled', 'boolean', 'multiple_choice', 'open_text'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

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
