import { useEffect, useRef, useState } from 'react';
import type { SlideEvent, SessionStatsEvent, SessionStatsEventV2, PreviousSlideMarker } from './types';

// Connects to the live presentation socket for a session code and surfaces the
// latest broadcast event. Auto-reconnects on drop with a small backoff. The
// returned `previousSlides` is the set of (slideNumber, hasResponse) pairs the
// server told us about when we joined (FR-2).
export function usePresentationSocket(code: string | undefined) {
  const [event, setEvent] = useState<SlideEvent | null>(null);
  const [stats, setStats] = useState<SessionStatsEvent | null>(null);
  const [statsV2, setStatsV2] = useState<SessionStatsEventV2 | null>(null);
  const [previousSlides, setPreviousSlides] = useState<PreviousSlideMarker[] | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!code) return;
    let stopped = false;
    let reconnect: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/session/${code}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (stopped) return;
        attemptRef.current = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as { type: string } & Record<string, unknown>;
          if (msg.type === 'SESSION_STATS_UPDATED') {
            // FR-3 — server may now include per-field breakdown.
            setStats(msg as unknown as SessionStatsEvent);
            setStatsV2(msg as unknown as SessionStatsEventV2);
          } else if (msg.type === 'PARTICIPANT_HELLO') {
            // FR-2 — server may echo a snapshot of which slides this participant already answered.
            const slides = (msg as { previousSlides?: PreviousSlideMarker[] }).previousSlides;
            if (Array.isArray(slides)) setPreviousSlides(slides);
          } else {
            setEvent(msg as unknown as SlideEvent);
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setConnected(false);
        // Backoff: 1.5s, 3s, 6s, capped at 8s.
        attemptRef.current = Math.min(attemptRef.current + 1, 4);
        const delay = Math.min(1500 * 2 ** (attemptRef.current - 1), 8000);
        reconnect = setTimeout(connect, delay);
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

  return { event, stats, statsV2, previousSlides, connected };
}