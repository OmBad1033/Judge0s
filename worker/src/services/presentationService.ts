import type { Env } from '../env';
import { newId, now } from '../utils/common';
import { extractPdfSlides, type ExtractedPresentation } from './pdfExtraction';
import { extractPptxSlides, deckToMarkdown } from './pptxExtraction';

const PPTX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PDF_CONTENT_TYPE = 'application/pdf';

function isPdfFile(name: string): boolean {
  return /\.pdf$/i.test(name);
}

function contentTypeFor(name: string, fallback: string): string {
  if (isPdfFile(name)) return PDF_CONTENT_TYPE;
  if (/\.pptx$/i.test(name)) return PPTX_CONTENT_TYPE;
  return fallback;
}

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
  // Set when the file is a PDF and per-page text was extracted.
  extractedJsonKey?: string | null;
  // Set for PPTX — the Markdown rendering of the structured slide content.
  extractedMdKey?: string | null;
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
    extractedJsonKey: (r.extracted_json_key as string) ?? undefined,
    extractedMdKey: (r.extracted_md_key as string) ?? undefined,
  };
}

export interface CreatePresentationInput {
  title: string;
  // Optional for PDFs — the slide count is derived from the page count.
  // Required for PPTX (validated by the route).
  slideCount?: number;
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
  extractedJsonKey: string | null;
  extractedMdKey: string | null;
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
  const isPdf = isPdfFile(input.file.name);

  // Extract per-slide content + count from the uploaded file and store the
  // JSON summary next to the original in R2. Both paths share the same
  // { source, fileName, slideCount, extractedAt, slides[] } shape.
  let slideCount = input.slideCount;
  let extracted: Awaited<ReturnType<typeof extractPdfSlides>> | Awaited<ReturnType<typeof extractPptxSlides>> | null = null;
  let extractedJsonKey: string | null = null;
  let extractedMdKey: string | null = null;
  if (isPdf) {
    extracted = await extractPdfSlides(input.file);
    slideCount = extracted.slideCount;
    extractedJsonKey = `${r2ObjectKey}.extracted.json`;
  } else {
    extracted = await extractPptxSlides(input.file);
    slideCount = extracted.slideCount;
    extractedJsonKey = `${r2ObjectKey}.extracted.json`;
    extractedMdKey = `${r2ObjectKey}.extracted.md`;
  }

  const contentType = contentTypeFor(input.file.name, input.file.type || PPTX_CONTENT_TYPE);

  await env.PRESENTATION_BUCKET.put(r2ObjectKey, input.file, {
    httpMetadata: { contentType },
  });

  if (extracted && extractedJsonKey) {
    await env.PRESENTATION_BUCKET.put(extractedJsonKey, JSON.stringify(extracted), {
      httpMetadata: { contentType: 'application/json' },
    });
    // Terminal visibility for the extraction pipeline — the summary JSON is
    // what gets stored to R2 alongside the uploaded file.
    console.log(`[extract] ${extracted.source} summary JSON saved to r2://${extractedJsonKey}`);
    console.log(JSON.stringify(extracted, null, 2));

    // PPTX also gets a Markdown rendering of the same structured content.
    if (extractedMdKey && extracted.source === 'pptx') {
      const md = deckToMarkdown(extracted as Awaited<ReturnType<typeof extractPptxSlides>>);
      await env.PRESENTATION_BUCKET.put(extractedMdKey, md, {
        httpMetadata: { contentType: 'text/markdown' },
      });
      console.log(`[extract] pptx markdown saved to r2://${extractedMdKey}`);
      console.log(md);
    }
  } else {
    console.warn(`[extract] no slide content extracted for ${input.file.name}`);
  }

  await env.DB.prepare(
    `INSERT INTO presentation_files (id, event_id, r2_key, original_name, status, slide_count, uploaded_by, uploaded_at, extracted_json_key, extracted_md_key)
     VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
  )
    .bind(fileId, id, r2ObjectKey, input.file.name, slideCount, uploadedBy, uploadedAt, extractedJsonKey, extractedMdKey)
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
    .bind(id, input.title, input.file.name, r2ObjectKey, slideCount, uploadedAt)
    .run();

  return {
    id,
    title: input.title,
    originalFilename: input.file.name,
    r2ObjectKey,
    slideCount: slideCount!,
    createdAt: uploadedAt,
    status: 'ready',
    presentationFileId: fileId,
    uploadedBy,
    extractedJsonKey,
    extractedMdKey,
  };
}

export async function getPresentation(env: Env, id: string): Promise<Presentation | null> {
  const row = await env.DB.prepare(
    `SELECT p.*, pf.status AS status, pf.id AS presentation_file_id, pf.uploaded_by AS uploaded_by,
            pf.extracted_json_key AS extracted_json_key, pf.extracted_md_key AS extracted_md_key
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
  ).all<Record<string, unknown>>();

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
    extractedJsonKey: null,
    extractedMdKey: null,
  };
}

// Full cascade delete of a presentation ("event" in the new model):
// responses, participants, sessions, slides, default questions, file records,
// the presentation row itself, plus every R2 object under its prefix.
// D1 batch runs in an implicit transaction, so the DB stays consistent even
// if the R2 cleanup below fails.
export async function deletePresentation(env: Env, id: string): Promise<boolean> {
  const existing = await env.DB.prepare('SELECT id FROM presentations WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) return false;

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM feedback_responses WHERE session_id IN (SELECT id FROM presentation_sessions WHERE presentation_id = ?)`,
    ).bind(id),
    env.DB.prepare(
      `DELETE FROM default_responses WHERE session_id IN (SELECT id FROM presentation_sessions WHERE presentation_id = ?)`,
    ).bind(id),
    env.DB.prepare(
      `DELETE FROM participants WHERE session_id IN (SELECT id FROM presentation_sessions WHERE presentation_id = ?)`,
    ).bind(id),
    env.DB.prepare(
      `DELETE FROM feedback_fields WHERE slide_id IN (SELECT id FROM slides WHERE presentation_id = ?)`,
    ).bind(id),
    // AI Slide Config — Phase 1/2 tables (FK to slides / events).
    env.DB.prepare(
      `DELETE FROM ai_field_suggestions WHERE slide_id IN (SELECT id FROM slides WHERE presentation_id = ?)`,
    ).bind(id),
    env.DB.prepare(
      `DELETE FROM ai_slide_suggestions WHERE slide_id IN (SELECT id FROM slides WHERE presentation_id = ?)`,
    ).bind(id),
    env.DB.prepare(`DELETE FROM ai_generation_jobs WHERE event_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM ai_chat_messages WHERE event_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM default_questions WHERE presentation_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM slides WHERE presentation_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM presentation_sessions WHERE presentation_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM presentation_files WHERE event_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM presentations WHERE id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM sessions WHERE event_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id),
  ]);

  // R2 cleanup — re-uploads add extra keys under the same prefix, so list
  // everything and delete each object rather than relying on one stored key.
  const listed = await env.PRESENTATION_BUCKET.list({ prefix: `presentations/${id}/` });
  await Promise.all(
    listed.objects.map((obj) => env.PRESENTATION_BUCKET.delete(obj.key)),
  );

  return true;
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
    extractedJsonKey: (row.extracted_json_key as string) ?? null,
    extractedMdKey: (row.extracted_md_key as string) ?? null,
  };
}