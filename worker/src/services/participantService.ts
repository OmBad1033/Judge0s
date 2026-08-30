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
