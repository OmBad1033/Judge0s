import type { Env } from '../env';
import { newId, now } from '../utils/common';

export interface Presentation {
  id: string;
  title: string;
  originalFilename: string;
  r2ObjectKey: string | null;
  slideCount: number;
  createdAt: string;
  // Phase 7 — additive fields the new model exposes. Existing fields above
  // are preserved verbatim for the current frontend.
  status?: 'processing' | 'ready' | 'failed';
  presentationFileId?: string;
  uploadedBy?: string;
}

function mapRow(r: Record<string, unknown>): Presentation {
  return {
    id: r.id as string,
    title: r.title as string,
    originalFilename: r.original_filename as string,
    r2ObjectKey: (r.r2_object_key as string) ?? null,
    slideCount: r.slide_count as number,
    createdAt: r.created_at as string,
    status: (r.status as Presentation['status']) ?? undefined,
    presentationFileId: (r.presentation_file_id as string) ?? undefined,
    uploadedBy: (r.uploaded_by as string) ?? undefined,
  };
}

export interface CreatePresentationInput {
  title: string;
  slideCount: number;
  file: File;
  // Phase 2 — when uploading onto an existing event, pass the event id so
  // the row in `presentations` (and the file's `event_id`) lines up with the
  // event. The compat layer treats `presentationId === eventId`.
  eventId?: string;
}

export interface PresentationFileRow {
  id: string;
  eventId: string;
  r2Key: string;
  originalName: string | null;
  status: 'processing' | 'ready' | 'failed';
  slideCount: number | null;
  uploadedBy: string;
  uploadedAt: string;
  errorMessage: string | null;
}

export async function createPresentation(
  env: Env,
  input: CreatePresentationInput,
  options: { uploadedBy?: string } = {},
): Promise<Presentation> {
  // Phase 2 — when eventId is provided, the new `presentations` row uses the
  // event's id so the legacy `presentationId` parameter == `eventId` everywhere.
  const id = input.eventId ?? newId();
  const fileId = newId();
  const uploadedBy = options.uploadedBy ?? 'local-admin';
  const uploadedAt = now();

  const r2ObjectKey = `presentations/${id}/${input.file.name}`;

  await env.PRESENTATION_BUCKET.put(r2ObjectKey, input.file, {
    httpMetadata: {
      contentType: input.file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
  });

  await env.DB.prepare(
    `INSERT INTO presentation_files (id, event_id, r2_key, original_name, status, slide_count, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, 'ready', ?, ?, ?)`,
  )
    .bind(fileId, id, r2ObjectKey, input.file.name, input.slideCount, uploadedBy, uploadedAt)
    .run();

  await env.DB.prepare(
    `INSERT INTO presentations (id, title, original_filename, r2_object_key, slide_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       original_filename = excluded.original_filename,
       r2_object_key = excluded.r2_object_key,
       slide_count = excluded.slide_count`,
  )
    .bind(id, input.title, input.file.name, r2ObjectKey, input.slideCount, uploadedAt)
    .run();

  return {
    id,
    title: input.title,
    originalFilename: input.file.name,
    r2ObjectKey,
    slideCount: input.slideCount,
    createdAt: uploadedAt,
    status: 'ready',
    presentationFileId: fileId,
    uploadedBy,
  };
}

export async function getPresentation(env: Env, id: string): Promise<Presentation | null> {
  const row = await env.DB.prepare(
    `SELECT p.*, pf.status AS status, pf.id AS presentation_file_id, pf.uploaded_by AS uploaded_by
     FROM presentations p
     LEFT JOIN presentation_files pf ON pf.event_id = p.id
     WHERE p.id = ?
     ORDER BY pf.uploaded_at DESC
     LIMIT 1`,
  )
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

// Phase 7 — re-upload. Creates a new presentation_files row alongside the
// existing one; the legacy `presentations` row stays untouched so existing
// sessions that reference its slides keep working.
export async function replacePresentation(
  env: Env,
  presentationId: string,
  file: File,
  options: { uploadedBy?: string } = {},
): Promise<PresentationFileRow> {
  const existing = await getPresentation(env, presentationId);
  if (!existing) throw new Error('Presentation not found');

  const fileId = newId();
  const uploadedBy = options.uploadedBy ?? 'local-admin';
  const uploadedAt = now();
  const r2Key = `presentations/${presentationId}/${uploadedAt}-${file.name}`;

  await env.PRESENTATION_BUCKET.put(r2Key, file, {
    httpMetadata: {
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
  });

  await env.DB.prepare(
    `INSERT INTO presentation_files (id, event_id, r2_key, original_name, status, slide_count, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, 'processing', NULL, ?, ?)`,
  )
    .bind(fileId, presentationId, r2Key, file.name, uploadedBy, uploadedAt)
    .run();

  return {
    id: fileId,
    eventId: presentationId,
    r2Key,
    originalName: file.name,
    status: 'processing',
    slideCount: null,
    uploadedBy,
    uploadedAt,
    errorMessage: null,
  };
}

// Phase 7 — poll status endpoint (the upload UI can show a "processing..."
// state if a re-upload is in flight).
export async function getPresentationStatus(env: Env, presentationId: string): Promise<PresentationFileRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM presentation_files WHERE event_id = ? ORDER BY uploaded_at DESC LIMIT 1`,
  )
    .bind(presentationId)
    .first();
  if (!row) return null;
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    r2Key: row.r2_key as string,
    originalName: (row.original_name as string) ?? null,
    status: row.status as PresentationFileRow['status'],
    slideCount: (row.slide_count as number) ?? null,
    uploadedBy: row.uploaded_by as string,
    uploadedAt: row.uploaded_at as string,
    errorMessage: (row.error_message as string) ?? null,
  };
}