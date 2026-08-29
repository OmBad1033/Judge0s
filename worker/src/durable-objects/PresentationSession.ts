import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

export class PresentationSession extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server as WebSocket);
      return new Response(null, { status: 101, webSocket: client as WebSocket });
    }

    // Internal control request: broadcast a pre-built event to all clients.
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/broadcast')) {
      const message = await request.json();
      await this.broadcast(message);
      return new Response('ok', { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    // POC protocol is server -> client only. Ignore inbound messages.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    ws.close(1011, 'websocket error');
  }

  async broadcast(message: unknown): Promise<void> {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // connection may already be closed
      }
    }
  }
}
