// AI Slide Config — Phase 2. Zod schemas for AI-generated slide content.
// Every OpenRouter response is re-validated here before anything touches D1 —
// never trust raw model output past this boundary.

import { z } from 'zod';
import { fieldTypeSchema } from './feedback';

// The model proposes one field config (mirrors the form-builder's field
// schema, but the label/options can come straight from the LLM).
export const aiFieldSuggestionSchema = z.object({
  fieldType: fieldTypeSchema,
  label: z.string().min(1).max(200),
  options: z.array(z.string().min(1).max(100)).max(20).optional(),
  isRequired: z.boolean().optional(),
});

// One slide's worth of suggestions.
export const aiSlideSuggestionSchema = z.object({
  slideNumber: z.number().int().min(1),
  title: z.string().max(300).optional(),
  summary: z.string().min(1).max(4000),
  fields: z.array(aiFieldSuggestionSchema).max(10).optional(),
});

export const aiDeckSuggestionSchema = z.object({
  slides: z.array(aiSlideSuggestionSchema).min(1),
});

export type AiDeckSuggestion = z.infer<typeof aiDeckSuggestionSchema>;
export type AiSlideSuggestion = z.infer<typeof aiSlideSuggestionSchema>;

// Per-slide "revise with my comments" — the admin can send free-text comments
// and the model returns a fresh suggestion for that one slide.
export const aiReviseRequestSchema = z.object({
  comments: z.string().min(1).max(2000),
  title: z.string().max(300).optional(),
  summary: z.string().max(4000).optional(),
});
