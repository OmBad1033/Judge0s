import { useEffect, useRef, useState } from 'react';
import type { SlideEvent, SessionStatsEvent } from './types';

// Connects to the live presentation socket for a session code and surfaces the
// latest broadcast event. Auto-reconnects on drop so refreshes/reconnects work.
export function usePresentationSocket(code: string | undefined) {
  const [event, setEvent] = useState<SlideEvent | null>(null);
  const [stats, setStats] = useState<SessionStatsEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!code) return;
    let stopped = false;
    let reconnect: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/session/${code}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!stopped) setConnected(true);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as { type: string };
          if (msg.type === 'SESSION_STATS_UPDATED') {
            setStats(msg as SessionStatsEvent);
          } else {
            setEvent(msg as SlideEvent);
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setConnected(false);
        reconnect = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnect);
      wsRef.current?.close();
    };
  }, [code]);

  return { event, stats, connected };
}
