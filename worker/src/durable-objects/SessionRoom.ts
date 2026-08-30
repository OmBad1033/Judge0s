import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

interface RoleMeta {
  role: 'admin' | 'participant';
  participantId?: string;
  joinToken?: string;
}

interface AttachedSocket {
  ws: WebSocket;
  meta: RoleMeta;
}

/**
 * Phase 4 — SessionRoom.
 * One instance per session_code (idFromName in the Worker route). Holds
 * in-memory state for connected sockets, current slide, and live stats.
 * Every state change is written through to D1 by the Worker before/alongside
 * the broadcast, so the DO is effectively a write-through cache.
 *
 * Hibernation: the WebSocket Hibernation API is used so idle sessions don't
 * keep the DO resident forever. On wake, in-memory state is rebuilt from D1
 * lazily on the first message.
 */
export class SessionRoom extends DurableObject<Env> {
  // WebSocket attachments survive hibernation.
  // Per the Hibernation API, attachments are arbitrary objects stored on the
  // WebSocket — we use them to remember the role/participantId.
  private inMemorySlideId: string | null = null;
  private inMemorySlideNumber: number | null = null;
  private inMemorySessionId: string | null = null;
  private inMemorySessionCode: string | null = null;
  private liveStats: Map<string, number> = new Map();

  // Construction is rare; the DO is normally woken by an incoming fetch/WS.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // Block the default blockConcurrencyWhile — we want to read D1 lazily so
    // a freshly-cold-started DO doesn't stall on cold reads.
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal Worker → DO commands (RPC-style, not user-facing).
    if (request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return new Response('Bad Request', { status: 400 });

      switch (body.command) {
        case 'setCurrentSlide': {
          // Worker has already written through to D1; we just remember it.
          this.inMemorySlideId = body.slideId as string;
          this.inMemorySlideNumber = body.slideNumber as number;
          // Force any participants to refetch the current slide.
          await this.broadcastParticipants({ type: 'SLIDE_CHANGED', slideNumber: this.inMemorySlideNumber });
          return new Response('ok');
        }
        case 'setSession': {
          this.inMemorySessionId = body.sessionId as string;
          this.inMemorySessionCode = body.sessionCode as string;
          return new Response('ok');
        }
        case 'endSession': {
          await this.broadcastAll({ type: 'SESSION_ENDED' });
          for (const ws of this.ctx.getWebSockets()) {
            try { ws.close(1000, 'session ended'); } catch { /* noop */ }
          }
          return new Response('ok');
        }
        case 'broadcastStats': {
          const message = { type: 'SESSION_STATS_UPDATED' as const, ...(body.stats as object) };
          // Stats only go to admin sockets.
          for (const ws of this.ctx.getWebSockets()) {
            const att = ws.deserializeAttachment() as RoleMeta | null;
            if (att?.role !== 'admin') continue;
            try { ws.send(JSON.stringify(message)); } catch { /* noop */ }
          }
          return new Response('ok');
        }
        case 'broadcastToAdmins': {
          for (const ws of this.ctx.getWebSockets()) {
            const att = ws.deserializeAttachment() as RoleMeta | null;
            if (att?.role !== 'admin') continue;
            try { ws.send(JSON.stringify(body.message)); } catch { /* noop */ }
          }
          return new Response('ok');
        }
        case 'participantCount': {
          let count = 0;
          for (const ws of this.ctx.getWebSockets()) {
            const att = ws.deserializeAttachment() as RoleMeta | null;
            if (att?.role === 'participant') count++;
          }
          return new Response(JSON.stringify({ count }));
        }
      }
      return new Response('Unknown command', { status: 400 });
    }

    // WebSocket upgrade — the user-facing path.
    if (request.headers.get('Upgrade') === 'websocket') {
      const role = (url.searchParams.get('role') as 'admin' | 'participant' | null) ?? 'participant';
      const participantId = url.searchParams.get('participantId') ?? undefined;
      const joinToken = url.searchParams.get('joinToken') ?? undefined;

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const meta: RoleMeta = { role, participantId, joinToken };
      this.ctx.acceptWebSocket(server as WebSocket);
      (server as WebSocket).serializeAttachment(meta);

      // If the session has a known current slide number, immediately notify
      // the new participant so they don't have to wait for the next event.
      if (role === 'participant' && this.inMemorySlideNumber != null) {
        try {
          (server as WebSocket).send(JSON.stringify({
            type: 'SLIDE_CHANGED',
            slideNumber: this.inMemorySlideNumber,
          }));
        } catch { /* noop */ }
      }
      return new Response(null, { status: 101, webSocket: client as WebSocket });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Server-driven protocol: server → client only. Inbound messages are
    // tolerated but ignored (a participant client may echo PING for liveness).
    if (typeof message !== 'string') return;
    try {
      const parsed = JSON.parse(message) as { type?: string };
      if (parsed.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch {
      // ignore malformed frames
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try { ws.close(code, reason); } catch { /* noop */ }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try { ws.close(1011, 'websocket error'); } catch { /* noop */ }
  }

  private async broadcastAll(message: unknown): Promise<void> {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch { /* noop */ }
    }
  }

  private async broadcastParticipants(message: unknown): Promise<void> {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as RoleMeta | null;
      if (att?.role !== 'participant') continue;
      try { ws.send(data); } catch { /* noop */ }
    }
  }
}