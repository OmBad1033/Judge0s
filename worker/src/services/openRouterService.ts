import { z } from 'zod';
import type { Env } from '../env';
import { now } from '../utils/common';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const MIN_RESPONSES_FOR_AI = 5;
const REQUEST_TIMEOUT_MS = 30_000;

export interface TextInsight {
  themes: { name: string; count: number }[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  sentimentScore: number; // -1..1
  summary: string;
}

const insightSchema = z.object({
  themes: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() })).max(12),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']),
  sentimentScore: z.number().min(-1).max(1),
  summary: z.string(),
});

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  return (fenced?.[1] ?? trimmed).trim();
}

function responseHash(responses: string[]): string {
  // Simple stable hash — enough to invalidate the cache when the response set
  // changes without storing the raw responses.
  const joined = responses.join('\u0000');
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0;
  }
  return `${joined.length}:${h.toString(36)}`;
}

async function callOpenRouter(env: Env, prompt: string): Promise<string> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const model = env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a feedback analysis assistant. Return ONLY valid JSON matching the requested schema. No markdown, no commentary.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no content');
  return content;
}

/**
 * Run theme clustering + sentiment for one text field's responses.
 * Throws on failure so the route can surface a clean error.
 */
export async function analyzeTexts(env: Env, fieldId: string, responses: string[]): Promise<TextInsight> {
  const cleaned = responses.map((r) => r.trim()).filter(Boolean);
  if (cleaned.length < MIN_RESPONSES_FOR_AI) {
    throw new Error('NOT_ENOUGH_RESPONSES');
  }

  const quoted = cleaned.map((r, i) => `[${i + 1}] ${r.slice(0, 500)}`).join('\n');
  const prompt = `Analyze these ${cleaned.length} open-ended feedback responses.\n
Return JSON with exactly:
- "themes": array of { "name": string, "count": number } — recurring topics, most frequent first, max 8 themes
- "sentiment": "positive" | "neutral" | "negative" | "mixed"
- "sentimentScore": number between -1 and 1
- "summary": one short sentence (max 40 words) summarizing the overall feedback

Responses:
${quoted}`;

  const content = stripCodeFence(await callOpenRouter(env, prompt));
  const parsed = insightSchema.safeParse(JSON.parse(content));
  if (!parsed.success) {
    throw new Error('OpenRouter returned an unparseable analysis');
  }
  return parsed.data;
}

/**
 * Cache-aware analysis: returns the cached insight when the response set is
 * unchanged, otherwise computes a fresh one and upserts the cache.
 */
export async function getOrCreateInsight(env: Env, fieldId: string, responses: string[]): Promise<TextInsight> {
  const hash = responseHash(responses);
  const existing = await env.DB.prepare(
    'SELECT response_hash, insight_json FROM text_analysis_cache WHERE field_id = ?',
  )
    .bind(fieldId)
    .first<{ response_hash: string; insight_json: string }>();

  if (existing && existing.response_hash === hash) {
    return JSON.parse(existing.insight_json) as TextInsight;
  }

  const insight = await analyzeTexts(env, fieldId, responses);
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO text_analysis_cache (field_id, response_hash, insight_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(field_id) DO UPDATE SET
       response_hash = excluded.response_hash,
       insight_json = excluded.insight_json,
       updated_at = excluded.updated_at`,
  )
    .bind(fieldId, hash, JSON.stringify(insight), ts, ts)
    .run();
  return insight;
}
