import type { Env } from '../env';
import { newId, now } from '../utils/common';
import * as sessionService from './sessionService';
import { signParticipantToken } from './jwtService';

export interface JoinResponse {
  participantId: string;
  sessionCode: string;
  status: string;
  currentSlide: number | null;
  // Phase 5 — additive; lets a client resume the WS connection after
  // backgrounding the phone.
  joinToken?: string;
}

type Result =
  | { ok: true; data: JoinResponse }
  | { ok: false; error: string; status: 400 | 404 | 409 };

export async function joinSession(
  env: Env,
  code: string,
  name: string,
  email: string,
): Promise<Result> {
  const session = await sessionService.getSession(env, code);
  if (!session) return { ok: false, error: 'NOT_FOUND', status: 404 };
  if (session.status === 'ended') return { ok: false, error: 'SESSION_ENDED', status: 409 };

  const row = await env.DB.prepare(
    `INSERT INTO participants (id, session_id, name, email, joined_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id, email) DO UPDATE SET name = excluded.name
     RETURNING id`,
  )
    .bind(newId(), session.id, name, email, now())
    .first<{ id: string }>();

  // Phase 5 — mint a long-lived signed token (8h) so the participant can
  // resume the WebSocket after backgrounding the phone.
  const joinToken = await signParticipantToken(row!.id, session.id, env.JWT_SECRET);

  return {
    ok: true,
    data: {
      participantId: row!.id,
      sessionCode: code,
      status: session.status,
      currentSlide: session.currentSlideNumber,
      joinToken,
    },
  };
}

export async function getParticipant(
  env: Env,
  participantId: string,
): Promise<{ id: string; sessionId: string; name: string; email: string } | null> {
  const row = await env.DB.prepare(
    'SELECT id, session_id, name, email FROM participants WHERE id = ?',
  )
    .bind(participantId)
    .first();
  return row
    ? {
        id: row.id as string,
        sessionId: row.session_id as string,
        name: row.name as string,
        email: row.email as string,
      }
    : null;
}

export interface SessionParticipant {
  id: string;
  name: string;
  joinedAt: string;
  lastSeenAt: string | null;
  hasCurrentSlideResponse: boolean;
  totalResponses: number;
}

export async function listSessionParticipants(
  env: Env,
  code: string,
): Promise<SessionParticipant[] | null> {
  const session = await sessionService.getSession(env, code);
  if (!session) return null;

  const { results: participants } = await env.DB.prepare(
    `SELECT id, name, joined_at FROM participants WHERE session_id = ? ORDER BY joined_at DESC`,
  )
    .bind(session.id)
    .all<{ id: string; name: string; joined_at: string }>();

  if (!participants || participants.length === 0) return [];

  const { results: fbCounts } = await env.DB.prepare(
    `SELECT participant_id, COUNT(*) AS c FROM feedback_responses WHERE session_id = ? GROUP BY participant_id`,
  )
    .bind(session.id)
    .all<{ participant_id: string; c: number }>();

  const { results: defCounts } = await env.DB.prepare(
    `SELECT participant_id, COUNT(*) AS c FROM default_responses WHERE session_id = ? GROUP BY participant_id`,
  )
    .bind(session.id)
    .all<{ participant_id: string; c: number }>();

  const totalMap = new Map<string, number>();
  for (const r of fbCounts) totalMap.set(r.participant_id, (totalMap.get(r.participant_id) ?? 0) + Number(r.c));
  for (const r of defCounts) totalMap.set(r.participant_id, (totalMap.get(r.participant_id) ?? 0) + Number(r.c));

  const currentSlideParticipants = new Set<string>();
  if (session.currentSlideNumber != null) {
    const { results: curFb } = await env.DB.prepare(
      `SELECT fr.participant_id FROM feedback_responses fr
       JOIN slides s ON s.id = fr.slide_id
       WHERE fr.session_id = ? AND s.slide_number = ?`,
    )
      .bind(session.id, session.currentSlideNumber)
      .all<{ participant_id: string }>();
    for (const r of curFb) currentSlideParticipants.add(r.participant_id);

    const { results: curDef } = await env.DB.prepare(
      `SELECT participant_id FROM default_responses
       WHERE session_id = ? AND slide_number = ?`,
    )
      .bind(session.id, session.currentSlideNumber)
      .all<{ participant_id: string }>();
    for (const r of curDef) currentSlideParticipants.add(r.participant_id);
  }

  return participants.map((p) => ({
    id: p.id,
    name: p.name,
    joinedAt: p.joined_at,
    lastSeenAt: p.joined_at,
    hasCurrentSlideResponse: currentSlideParticipants.has(p.id),
    totalResponses: totalMap.get(p.id) ?? 0,
  }));
}
