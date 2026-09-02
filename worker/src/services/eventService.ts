import type { Env } from '../env';
import { newId, now } from '../utils/common';

export interface Event {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  status: 'draft' | 'configured' | 'archived';
  createdAt: string;
  updatedAt: string;
}

function mapEvent(r: Record<string, unknown>): Event {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    ownerId: r.owner_id as string,
    status: r.status as Event['status'],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export interface CreateEventInput {
  name: string;
  description?: string;
  ownerId: string;
}

export async function createEvent(env: Env, input: CreateEventInput): Promise<Event> {
  const id = newId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO events (id, name, description, owner_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
  )
    .bind(id, input.name, input.description ?? null, input.ownerId, ts, ts)
    .run();
  return {
    id,
    name: input.name,
    description: input.description ?? null,
    ownerId: input.ownerId,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  };
}

export async function getEvent(env: Env, id: string): Promise<Event | null> {
  const row = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  return row ? mapEvent(row) : null;
}

export async function listEventsForUser(env: Env, userId: string, opts: { isSuperAdmin: boolean }): Promise<Event[]> {
  if (opts.isSuperAdmin) {
    const { results } = await env.DB.prepare(
      'SELECT * FROM events ORDER BY updated_at DESC LIMIT 200',
    ).all();
    return (results as Record<string, unknown>[]).map(mapEvent);
  }
  const { results } = await env.DB.prepare(
    `SELECT e.* FROM events e
     LEFT JOIN event_admins ea ON ea.event_id = e.id
     WHERE e.owner_id = ? OR ea.user_id = ?
     ORDER BY e.updated_at DESC
     LIMIT 200`,
  )
    .bind(userId, userId)
    .all();
  return (results as Record<string, unknown>[]).map(mapEvent);
}

export interface PatchEventInput {
  name?: string;
  description?: string;
  status?: 'draft' | 'configured' | 'archived';
}

export async function patchEvent(env: Env, id: string, patch: PatchEventInput): Promise<Event | null> {
  const existing = await getEvent(env, id);
  if (!existing) return null;
  const next = {
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    status: patch.status ?? existing.status,
  };
  await env.DB.prepare(
    `UPDATE events SET name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(next.name, next.description, next.status, now(), id)
    .run();
  return { ...existing, ...next, updatedAt: now() };
}

export async function deleteEvent(env: Env, id: string): Promise<boolean> {
  const result = await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

// Presentation-level "what am I building" context for AI suggestions. Stored on
// the event row (ai_context) so the same deck-level prompt applies to every
// slide and feeds the generation cache key.
export async function getEventAiContext(env: Env, id: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT ai_context FROM events WHERE id = ?')
    .bind(id)
    .first<{ ai_context: string | null }>();
  return row?.ai_context ?? null;
}

export async function setEventAiContext(env: Env, id: string, aiContext: string | null): Promise<boolean> {
  const result = await env.DB.prepare('UPDATE events SET ai_context = ?, updated_at = ? WHERE id = ?')
    .bind(aiContext, now(), id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

// Compat helper — the legacy `presentations` table is now a 1:1 mirror of
// `events` (Phase 7 set the same id on the presentation row and the
// `events` row). Use this whenever the legacy `presentationId` parameter is
// passed into new event-scoped code paths.
export async function eventIdFromPresentation(env: Env, presentationId: string): Promise<string | null> {
  const event = await getEvent(env, presentationId);
  if (event) return event.id;
  // Fallback: create the event on the fly from the legacy presentation.
  const pres = await env.DB.prepare('SELECT title FROM presentations WHERE id = ?')
    .bind(presentationId)
    .first<{ title: string }>();
  if (!pres) return null;
  const created = await createEvent(env, { name: pres.title, ownerId: 'local-admin' });
  return created.id;
}