import type { Env } from '../env';
import { newId, now } from '../utils/common';

export interface Presentation {
  id: string;
  title: string;
  originalFilename: string;
  r2ObjectKey: string | null;
  slideCount: number;
  createdAt: string;
}

function mapRow(r: Record<string, unknown>): Presentation {
  return {
    id: r.id as string,
    title: r.title as string,
    originalFilename: r.original_filename as string,
    r2ObjectKey: (r.r2_object_key as string) ?? null,
    slideCount: r.slide_count as number,
    createdAt: r.created_at as string,
  };
}

export interface CreatePresentationInput {
  title: string;
  slideCount: number;
  file: File;
}

export async function createPresentation(
  env: Env,
  input: CreatePresentationInput,
): Promise<Presentation> {
  const id = newId();
  const r2ObjectKey = `presentations/${id}/${input.file.name}`;
  await env.PRESENTATION_BUCKET.put(r2ObjectKey, input.file, {
    httpMetadata: {
      contentType: input.file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
  });
  const createdAt = now();
  await env.DB.prepare(
    'INSERT INTO presentations (id, title, original_filename, r2_object_key, slide_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, input.title, input.file.name, r2ObjectKey, input.slideCount, createdAt)
    .run();
  return {
    id,
    title: input.title,
    originalFilename: input.file.name,
    r2ObjectKey: r2ObjectKey,
    slideCount: input.slideCount,
    createdAt,
  };
}

export async function getPresentation(env: Env, id: string): Promise<Presentation | null> {
  const row = await env.DB.prepare('SELECT * FROM presentations WHERE id = ?')
    .bind(id)
    .first();
  return row ? mapRow(row) : null;
}

export interface PresentationSummary extends Presentation {
  configuredSlides: number;
  latestSession: {
    sessionCode: string;
    status: string;
    currentSlideNumber: number | null;
  } | null;
}

// P1 §3.1 — admin library: presentations with configured-slide count + latest session.
// Derived via joins/aggregates; no migration.
export async function listPresentations(env: Env): Promise<PresentationSummary[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, title, original_filename, r2_object_key, slide_count, created_at FROM presentations ORDER BY created_at DESC LIMIT 100',
  ).all();

  const summaries: PresentationSummary[] = [];
  for (const r of results as Record<string, unknown>[]) {
    const presentation = mapRow(r);

    const configured = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM slides WHERE presentation_id = ?',
    )
      .bind(presentation.id)
      .first<{ c: number }>();

    const latest = await env.DB.prepare(
      'SELECT session_code, status, current_slide_number FROM presentation_sessions WHERE presentation_id = ? ORDER BY created_at DESC LIMIT 1',
    )
      .bind(presentation.id)
      .first<{ session_code: string; status: string; current_slide_number: number | null }>();

    summaries.push({
      ...presentation,
      configuredSlides: configured?.c ?? 0,
      latestSession: latest
        ? {
            sessionCode: latest.session_code,
            status: latest.status,
            currentSlideNumber: latest.current_slide_number ?? null,
          }
        : null,
    });
  }
  return summaries;
}
