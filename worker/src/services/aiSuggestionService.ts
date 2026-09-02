// AI Slide Config — Phase 2. Generation of slide title/summary/field
// suggestions from an uploaded deck's extracted content, via OpenRouter.
//
// Design notes (per ai_plan.md):
//   - Batches of 8 slides, concurrency 4, so a large deck stays inside one
//     Worker request without CPU-time errors.
//   - Every model response is re-validated against validation/ai.ts before
//     anything is written.
//   - A batch failure marks only that batch in ai_generation_jobs.error, never
//     the whole job.
//   - Results are cached (text_analysis_cache with kind='slide_suggestion')
//     keyed on hash(eventId + extractedContent + ai_context) so re-running on
//     unchanged content is a cache hit.

import type { Env } from '../env';
import { newId, now } from '../utils/common';
import { aiFieldSuggestionSchema, aiSlideSuggestionSchema, type AiSlideSuggestion } from '../validation/ai';
import { fieldTypeSchema, type FieldType } from '../validation/feedback';

const BATCH_SIZE = 8;
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 60_000;

// --- Extracted-content loading ---------------------------------------------

interface ExtractedSlideContent {
  slideNumber: number;
  title: string | null;
  bodyText: string;
  notes: string | null;
}

interface DeckContent {
  eventId: string;
  fileId: string | null;
  title: string;
  slides: ExtractedSlideContent[];
}

/**
 * Load the most recently uploaded deck's extracted content from R2
 * (extracted_json_key on presentation_files). The extracted JSON has one of
 * two shapes depending on source:
 *   pdf  → { source, slideCount, slides: [{ pageNumber, text }] }
 *   pptx → { source, slideCount, slides: [{ slideNumber, title, body: [{level,text}], notes, markdown }] }
 * Returns null if no extractable content exists (admin-typed-only decks).
 */
export async function loadDeckContent(env: Env, eventId: string): Promise<DeckContent | null> {
  const fileRow = await env.DB.prepare(
    `SELECT id, extracted_json_key FROM presentation_files
     WHERE event_id = ? AND extracted_json_key IS NOT NULL
     ORDER BY uploaded_at DESC LIMIT 1`,
  )
    .bind(eventId)
    .first<{ id: string; extracted_json_key: string }>();
  if (!fileRow) return null;

  const event = await env.DB.prepare('SELECT name FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ name: string }>();

  const obj = await env.PRESENTATION_BUCKET.get(fileRow.extracted_json_key);
  if (!obj) return null;
  const raw = (await obj.text()) as string;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const source = parsed.source;
  const slidesRaw = Array.isArray(parsed.slides) ? (parsed.slides as Record<string, unknown>[]) : [];
  const slides: ExtractedSlideContent[] = [];

  if (source === 'pdf') {
    for (const s of slidesRaw) {
      const pageNumber = Number(s.pageNumber ?? 0);
      const text = String(s.text ?? '').trim();
      if (!text) continue;
      slides.push({ slideNumber: pageNumber, title: null, bodyText: text, notes: null });
    }
  } else {
    // pptx shape
    for (const s of slidesRaw) {
      const slideNumber = Number(s.slideNumber ?? 0);
      const bodyArr = Array.isArray(s.body) ? (s.body as { level?: number; text?: string }[]) : [];
      const bodyText = bodyArr
        .map((b) => String(b.text ?? '').trim())
        .filter(Boolean)
        .join('\n');
      const notes = s.notes ? String(s.notes).trim() : null;
      if (!String(s.title ?? '').trim() && !bodyText && !notes) continue;
      slides.push({
        slideNumber,
        title: s.title ? String(s.title).trim() : null,
        bodyText,
        notes,
      });
    }
  }

  return {
    eventId,
    fileId: fileRow.id,
    title: event?.name ?? '',
    slides,
  };
}

// --- OpenRouter call --------------------------------------------------------

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

interface ModelField {
  fieldType: FieldType;
  label: string;
  options?: string[];
  isRequired?: boolean;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  return (fenced?.[1] ?? trimmed).trim();
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
            'You are a presentation-coaching assistant. Given a slide\'s extracted content, propose an admin-facing slide summary (what participants read) and, when the content warrants it, a feedback question. Return ONLY valid JSON matching the requested schema. No markdown, no commentary.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no content');
  return content;
}

function buildPrompt(eventTitle: string, aiContext: string | null, slides: ExtractedSlideContent[]): string {
  const slideBlock = slides
    .map((s) => {
      const title = s.title ? `Title: ${s.title}` : '(no title)';
      const body = s.bodyText ? `Content:\n${s.bodyText}` : '(no body content)';
      const notes = s.notes ? `Speaker notes: ${s.notes}` : '';
      return `Slide ${s.slideNumber}\n${title}\n${body}\n${notes}`.trim();
    })
    .join('\n\n---\n\n');

  return `Presentation: "${eventTitle}"${aiContext ? `\nContext: ${aiContext}` : ''}

For each slide below, propose:
- "title": a concise slide title (if the extracted one is missing/weak, improve it)
- "summary": a 1-3 sentence participant-facing summary (plain language, no jargon)
- "fields": an optional feedback config for that slide. Use these field types only: ${fieldTypeSchema.options.join(', ')}. Pick at most 1-2 fields. A "text"/"textarea" field works for open feedback. Set "isRequired": false unless the question is core to the slide.

Slides:
${slideBlock}

Return JSON exactly like:
{"slides":[{"slideNumber":1,"title":"...","summary":"...","fields":[{"fieldType":"single_select","label":"How clear was this?","options":["Very clear","Clear","Confusing"],"isRequired":false}]}]}`;
}

// --- Validation helpers -----------------------------------------------------

function normalizeSlide(raw: { slideNumber?: unknown; title?: unknown; summary?: unknown; fields?: unknown }): AiSlideSuggestion {
  const fields: ModelField[] = [];
  if (Array.isArray(raw.fields)) {
    for (const f of raw.fields as Record<string, unknown>[]) {
      const candidate = {
        fieldType: f.fieldType,
        label: f.label,
        options: f.options,
        isRequired: f.isRequired,
      };
      const parsed = aiFieldSuggestionSchema.safeParse(candidate);
      if (!parsed.success) continue; // reject unknown field types at the boundary
      fields.push(parsed.data as ModelField);
    }
  }
  return {
    slideNumber: Number(raw.slideNumber ?? 0),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 300) : undefined,
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 4000) : '',
    fields,
  };
}

// Hash used for the suggestion cache: identical input (event + content + ai
// context) must not re-bill the LLM. Scoped to whatever slide set is being
// generated (whole deck for "generate all", one slide for per-slide generate).
function hashForSlides(
  eventId: string,
  eventTitle: string,
  slides: ExtractedSlideContent[],
  aiContext: string | null,
): string {
  const joined = JSON.stringify({ eventId, title: eventTitle, slides, aiContext });
  let h = 5381;
  for (let i = 0; i < joined.length; i++) h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0;
  return `${joined.length}:${h.toString(36)}`;
}

// text_analysis_cache field_id values for suggestion rows. The deck-level row
// caches a full "generate all" result; per-slide rows cache single-slide
// results keyed the same way so re-generating one slide is free on retry.
function deckCacheFieldId(eventId: string): string {
  return `evt:${eventId}`;
}
function slideCacheFieldId(eventId: string, slideNumber: number): string {
  return `evt:${eventId}:slide:${slideNumber}`;
}

// Invalidate the cached suggestion rows for an event. Called whenever a
// per-slide write happens (single-slide generate, revise) or the deck context
// changes, so a later "generate all" never replays a stale deck-level cache.
// When called with no slideNumber (e.g. context changed), clears the deck-level
// row AND every per-slide row — all were generated under the old context.
export async function invalidateSuggestionCache(env: Env, eventId: string, slideNumber?: number): Promise<void> {
  if (slideNumber !== undefined) {
    await env.DB.prepare('DELETE FROM text_analysis_cache WHERE field_id = ?')
      .bind(deckCacheFieldId(eventId))
      .run();
    await env.DB.prepare('DELETE FROM text_analysis_cache WHERE field_id = ?')
      .bind(slideCacheFieldId(eventId, slideNumber))
      .run();
    return;
  }
  await env.DB.prepare(`DELETE FROM text_analysis_cache WHERE field_id = ? OR field_id LIKE ?`)
    .bind(deckCacheFieldId(eventId), `evt:${eventId}:slide:%`)
    .run();
}

// --- Suggestion row writing ------------------------------------------------

export interface SlideSuggestionRow {
  slideId: string | null;
  slideNumber: number;
  suggestedTitle: string | null;
  suggestedSummary: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string | null;
  fields: FieldSuggestionRow[];
}

export interface FieldSuggestionRow {
  id: string;
  orderIndex: number;
  fieldType: string;
  label: string;
  options: string[] | null;
  isRequired: boolean;
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * Ensure a `slides` row exists for every slide number in the deck (the
 * extractor stores content in R2 but slide rows are only created when an admin
 * saves a slide). We create placeholder rows so ai_slide_suggestions has a
 * slide_id to point at and approval has a target.
 */
async function ensureSlideRows(
  env: Env,
  eventId: string,
  slideNumbers: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const existing = await env.DB.prepare(
    'SELECT id, slide_number FROM slides WHERE presentation_id = ?',
  )
    .bind(eventId)
    .all<{ id: string; slide_number: number }>();
  for (const row of existing.results) map.set(row.slide_number, row.id);

  const ts = now();
  for (const n of slideNumbers) {
    if (!map.has(n)) {
      const id = newId();
      await env.DB.prepare(
        `INSERT INTO slides (id, presentation_id, slide_number, title, summary, created_at)
         VALUES (?, ?, ?, NULL, '', ?)`,
      )
        .bind(id, eventId, n, ts)
        .run();
      map.set(n, id);
    }
  }
  return map;
}

// Store the validated suggestion set for one batch.
async function writeBatchSuggestions(
  env: Env,
  slideIdMap: Map<number, string>,
  suggestions: AiSlideSuggestion[],
): Promise<void> {
  const ts = now();
  for (const s of suggestions) {
    const slideId = slideIdMap.get(s.slideNumber);
    if (!slideId) continue;

    // Remove stale suggestions for this slide first (they may have been
    // superseded by a regenerate).
    await env.DB.prepare('DELETE FROM ai_field_suggestions WHERE slide_id = ?')
      .bind(slideId)
      .run();

    await env.DB.prepare(
      `INSERT INTO ai_slide_suggestions (slide_id, suggested_title, suggested_summary, status, created_at)
       VALUES (?, ?, ?, 'pending', ?)
       ON CONFLICT(slide_id) DO UPDATE SET
         suggested_title = excluded.suggested_title,
         suggested_summary = excluded.suggested_summary,
         status = 'pending',
         created_at = excluded.created_at`,
    )
      .bind(slideId, s.title ?? null, s.summary || null, ts)
      .run();

    for (let i = 0; i < (s.fields?.length ?? 0); i++) {
      const f = s.fields![i];
      await env.DB.prepare(
        `INSERT INTO ai_field_suggestions (id, slide_id, order_index, field_type, label, options_json, is_required, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
        .bind(
          newId(),
          slideId,
          i,
          f.fieldType,
          f.label,
          f.options && f.options.length > 0 ? JSON.stringify(f.options) : null,
          f.isRequired ? 1 : 0,
          ts,
        )
        .run();
    }
  }
}

// --- Public API -------------------------------------------------------------

export type GenerateResult =
  | { ok: true; slides: number; jobId: string; cached: boolean }
  | { ok: false; error: string; status?: number };

/**
 * Generate suggestions for the whole deck. Runs inline (no queue) in batches,
 * validates against the Zod boundary, and tracks progress in ai_generation_jobs.
 */
export async function generateForPresentation(env: Env, eventId: string): Promise<GenerateResult> {
  const event = await env.DB.prepare('SELECT name, ai_context FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ name: string; ai_context: string | null }>();
  if (!event) return { ok: false, error: 'NOT_FOUND', status: 404 };

  const content = await loadDeckContent(env, eventId);
  if (!content || content.slides.length === 0) {
    return { ok: false, error: 'NO_EXTRACTED_CONTENT', status: 400 };
  }

  // Cache check — identical content + context is a cache hit (no LLM call).
  const aiContext = event.ai_context ?? null;
  const hash = hashForSlides(eventId, content.title, content.slides, aiContext);
  const deckFieldId = deckCacheFieldId(eventId);
  const cached = await env.DB.prepare(
    `SELECT 1 AS ok FROM text_analysis_cache
     WHERE field_id = ? AND kind = 'slide_suggestion' AND response_hash = ?`,
  )
    .bind(deckFieldId, hash)
    .first<{ ok: number }>();

  // Read the stored cache payload (if present) so a hit can write straight to
  // the suggestion tables without an LLM call.
  if (cached) {
    const cachedRow = await env.DB.prepare(
      `SELECT insight_json FROM text_analysis_cache
       WHERE field_id = ? AND kind = 'slide_suggestion' AND response_hash = ?`,
    )
      .bind(deckFieldId, hash)
      .first<{ insight_json: string }>();
    if (cachedRow) {
      let parsed: AiSlideSuggestion[] = [];
      try {
        parsed = JSON.parse(cachedRow.insight_json) as AiSlideSuggestion[];
      } catch {
        parsed = [];
      }
      if (parsed.length > 0) {
        const slideIdMap = await ensureSlideRows(env, eventId, parsed.map((s) => s.slideNumber));
        await writeBatchSuggestions(env, slideIdMap, parsed);
        return { ok: true, slides: parsed.length, jobId: '', cached: true };
      }
    }
  }

  const jobId = newId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO ai_generation_jobs (id, event_id, presentation_file_id, status, created_at)
     VALUES (?, ?, ?, 'running', ?)`,
  )
    .bind(jobId, eventId, content.fileId, ts)
    .run();

  const slideNumbers = content.slides.map((s) => s.slideNumber);
  const slideIdMap = await ensureSlideRows(env, eventId, slideNumbers);
  const allSuggestions: AiSlideSuggestion[] = [];
  const errors: string[] = [];

  const slides = content.slides;
  for (let start = 0; start < slides.length; start += BATCH_SIZE) {
    const batch = slides.slice(start, start + BATCH_SIZE);
    // Split into concurrency-4 waves within the batch.
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const wave = batch.slice(i, i + CONCURRENCY);
      const waveResults = await Promise.allSettled(
        wave.map(async (slide) => {
          const prompt = buildPrompt(event.name, aiContext, [slide]);
          const contentRaw = stripCodeFence(await callOpenRouter(env, prompt));
          const parsed = JSON.parse(contentRaw) as { slides?: unknown[] };
          const slideRaw = Array.isArray(parsed.slides) ? (parsed.slides[0] as Record<string, unknown> | undefined) : undefined;
          if (!slideRaw) throw new Error('Model returned no slides array');
          return normalizeSlide(slideRaw);
        }),
      );
      waveResults.forEach((r, idx) => {
        const slide = wave[idx];
        if (r.status === 'fulfilled') {
          allSuggestions.push({ ...r.value, slideNumber: slide.slideNumber });
        } else {
          errors.push(`slide ${slide.slideNumber}: ${(r.reason as Error).message}`);
        }
      });
    }
  }

  if (allSuggestions.length === 0) {
    await env.DB.prepare(
      `UPDATE ai_generation_jobs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
    )
      .bind(errors.join('; ').slice(0, 2000), now(), jobId)
      .run();
    return { ok: false, error: 'GENERATION_FAILED' };
  }

  await writeBatchSuggestions(env, slideIdMap, allSuggestions);

  // Persist to the cache so re-runs on unchanged content are free.
  const completedTs = now();
  await env.DB.prepare(
    `INSERT INTO text_analysis_cache (field_id, kind, response_hash, insight_json, created_at, updated_at)
     VALUES (?, 'slide_suggestion', ?, ?, ?, ?)
     ON CONFLICT(field_id) DO UPDATE SET
       kind = 'slide_suggestion',
       response_hash = excluded.response_hash,
       insight_json = excluded.insight_json,
       updated_at = excluded.updated_at`,
  )
    .bind(deckFieldId, hash, JSON.stringify(allSuggestions), ts, completedTs)
    .run();

  // Even with some batch failures, mark the job completed if we got most of the
  // deck; failed batches are reported in the error field.
  await env.DB.prepare(
    `UPDATE ai_generation_jobs SET status = ?, error = ?, completed_at = ? WHERE id = ?`,
  )
    .bind(
      errors.length > 0 && allSuggestions.length > 0 ? 'completed' : 'failed',
      errors.length > 0 ? errors.join('; ').slice(0, 2000) : null,
      completedTs,
      jobId,
    )
    .run();

  return { ok: true, slides: allSuggestions.length, jobId, cached: false };
}

// List current pending suggestions grouped per slide, in slide order.
export async function listSuggestions(env: Env, eventId: string): Promise<SlideSuggestionRow[]> {
  const slides = await env.DB.prepare(
    `SELECT id, slide_number FROM slides WHERE presentation_id = ? ORDER BY slide_number`,
  )
    .bind(eventId)
    .all<{ id: string; slide_number: number }>();

  const rows: SlideSuggestionRow[] = [];
  for (const s of slides.results) {
    const slideSugg = await env.DB.prepare(
      `SELECT slide_id, suggested_title, suggested_summary, status, created_at
       FROM ai_slide_suggestions WHERE slide_id = ?`,
    )
      .bind(s.id)
      .first<{ slide_id: string; suggested_title: string | null; suggested_summary: string | null; status: string; created_at: string | null }>();

    if (!slideSugg) continue; // only slides that have suggestions

    const fieldRows = await env.DB.prepare(
      `SELECT id, order_index, field_type, label, options_json, is_required, status
       FROM ai_field_suggestions WHERE slide_id = ? ORDER BY order_index`,
    )
      .bind(s.id)
      .all<{
        id: string;
        order_index: number;
        field_type: string;
        label: string;
        options_json: string | null;
        is_required: number | null;
        status: string;
      }>();

    rows.push({
      slideId: s.id,
      slideNumber: s.slide_number,
      suggestedTitle: slideSugg.suggested_title,
      suggestedSummary: slideSugg.suggested_summary,
      status: slideSugg.status as SlideSuggestionRow['status'],
      createdAt: slideSugg.created_at,
      fields: fieldRows.results.map((f) => ({
        id: f.id,
        orderIndex: f.order_index,
        fieldType: f.field_type,
        label: f.label,
        options: f.options_json ? (JSON.parse(f.options_json) as string[]) : null,
        isRequired: f.is_required === 1,
        status: f.status as FieldSuggestionRow['status'],
      })),
    });
  }
  return rows;
}

export type SingleSlideGenerateResult =
  | { ok: true; suggestion: AiSlideSuggestion; cached: boolean }
  | { ok: false; error: string; status?: number };

/**
 * Generate (or regenerate) a suggestion for ONE slide. Used by the "Generate
 * for this slide" button on the configure page. Reads the same event context
 * and extracted content as whole-deck generation, but only calls the model for
 * the requested slide number. Invalidate the deck-level cache so a later
 * "Generate all" re-runs rather than replaying a stale deck over this slide.
 */
export async function generateForSlide(env: Env, eventId: string, slideNumber: number): Promise<SingleSlideGenerateResult> {
  const event = await env.DB.prepare('SELECT name, ai_context FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ name: string; ai_context: string | null }>();
  if (!event) return { ok: false, error: 'NOT_FOUND', status: 404 };

  const content = await loadDeckContent(env, eventId);
  const slide = content?.slides.find((s) => s.slideNumber === slideNumber) ?? null;
  if (!content || !slide) {
    return { ok: false, error: 'NO_EXTRACTED_CONTENT', status: 400 };
  }

  const aiContext = event.ai_context ?? null;

  // Per-slide cache hit → replay without an LLM call.
  const fieldId = slideCacheFieldId(eventId, slideNumber);
  const hash = hashForSlides(eventId, content.title, [slide], aiContext);
  const cached = await env.DB.prepare(
    `SELECT insight_json FROM text_analysis_cache
     WHERE field_id = ? AND kind = 'slide_suggestion' AND response_hash = ?`,
  )
    .bind(fieldId, hash)
    .first<{ insight_json: string }>();
  if (cached) {
    let parsed: AiSlideSuggestion | null = null;
    try {
      const arr = JSON.parse(cached.insight_json) as AiSlideSuggestion[];
      parsed = arr[0] ?? null;
    } catch {
      parsed = null;
    }
    if (parsed) {
      const slideIdMap = await ensureSlideRows(env, eventId, [parsed.slideNumber]);
      await writeBatchSuggestions(env, slideIdMap, [parsed]);
      return { ok: true, suggestion: parsed, cached: true };
    }
  }

  // Fresh generation for this one slide.
  let normalized: AiSlideSuggestion;
  try {
    const prompt = buildPrompt(event.name, aiContext, [slide]);
    const contentRaw = stripCodeFence(await callOpenRouter(env, prompt));
    const parsed = JSON.parse(contentRaw) as { slides?: unknown[] };
    const slideRaw = Array.isArray(parsed.slides) ? (parsed.slides[0] as Record<string, unknown> | undefined) : undefined;
    if (!slideRaw) throw new Error('Model returned no slides array');
    normalized = normalizeSlide(slideRaw);
  } catch (e) {
    return { ok: false, error: 'GENERATION_FAILED', status: 502 };
  }
  normalized = { ...normalized, slideNumber: slide.slideNumber };

  // Per-slide writes invalidate the deck cache so "generate all" re-runs.
  await invalidateSuggestionCache(env, eventId, slide.slideNumber);

  const slideIdMap = await ensureSlideRows(env, eventId, [slide.slideNumber]);
  await writeBatchSuggestions(env, slideIdMap, [normalized]);

  // Cache this single slide for cheap retries.
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO text_analysis_cache (field_id, kind, response_hash, insight_json, created_at, updated_at)
     VALUES (?, 'slide_suggestion', ?, ?, ?, ?)
     ON CONFLICT(field_id) DO UPDATE SET
       kind = 'slide_suggestion',
       response_hash = excluded.response_hash,
       insight_json = excluded.insight_json,
       updated_at = excluded.updated_at`,
  )
    .bind(fieldId, hash, JSON.stringify([normalized]), ts, ts)
    .run();

  return { ok: true, suggestion: normalized, cached: false };
}

/**
 * "Revise with my comments": regenerate a suggestion for ONE slide given
 * free-text admin feedback. Returns the fresh slide suggestion.
 */
export async function reviseSlideSuggestion(
  env: Env,
  eventId: string,
  slideId: string,
  comments: string,
): Promise<AiSlideSuggestion | null> {
  const slide = await env.DB.prepare(
    'SELECT slide_number, title, summary FROM slides WHERE id = ? AND presentation_id = ?',
  )
    .bind(slideId, eventId)
    .first<{ slide_number: number; title: string | null; summary: string }>();
  if (!slide) return null;

  const deck = await loadDeckContent(env, eventId);
  const extracted = deck?.slides.find((s) => s.slideNumber === slide.slide_number) ?? null;
  const currentTitle = slide.title ?? extracted?.title ?? null;
  const currentSummary = slide.summary || extracted?.bodyText.slice(0, 800) || '(no content yet)';

  const prompt = `You previously suggested content for slide ${slide.slide_number} of "${deck?.title ?? ''}".

Current title: ${currentTitle ?? '(none)'}
Current summary: ${currentSummary}

Extracted slide content:
${extracted ? `${extracted.title ? `Title: ${extracted.title}\n` : ''}${extracted.bodyText || '(none)'}${extracted.notes ? `\nNotes: ${extracted.notes}` : ''}` : '(none)'}

The admin wants these changes (their comments are authoritative — apply them while keeping the summary participant-friendly):
${comments}

Return JSON exactly like:
{"slideNumber":${slide.slide_number},"title":"...","summary":"...","fields":[{"fieldType":"single_select","label":"...","options":["..."],"isRequired":false}]}
Keep fields optional; use types only from: ${fieldTypeSchema.options.join(', ')}.`;

  const contentRaw = stripCodeFence(await callOpenRouter(env, prompt));
  const parsed = JSON.parse(contentRaw) as { slideNumber?: unknown; title?: unknown; summary?: unknown; fields?: unknown };
  const normalized = normalizeSlide(parsed);

  // A revise is a per-slide write — the deck-level cache may no longer be
  // authoritative for this slide.
  await invalidateSuggestionCache(env, eventId, slide.slide_number);

  // Persist as a fresh pending suggestion (replacing the old one for this slide).
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO ai_slide_suggestions (slide_id, suggested_title, suggested_summary, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)
     ON CONFLICT(slide_id) DO UPDATE SET
       suggested_title = excluded.suggested_title,
       suggested_summary = excluded.suggested_summary,
       status = 'pending',
       created_at = excluded.created_at`,
  )
    .bind(slideId, normalized.title ?? null, normalized.summary || null, ts)
    .run();
  await env.DB.prepare('DELETE FROM ai_field_suggestions WHERE slide_id = ?')
    .bind(slideId)
    .run();
  for (let i = 0; i < (normalized.fields?.length ?? 0); i++) {
    const f = normalized.fields![i];
    await env.DB.prepare(
      `INSERT INTO ai_field_suggestions (id, slide_id, order_index, field_type, label, options_json, is_required, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(newId(), slideId, i, f.fieldType, f.label, f.options?.length ? JSON.stringify(f.options) : null, f.isRequired ? 1 : 0, ts)
      .run();
  }
  return normalized;
}
