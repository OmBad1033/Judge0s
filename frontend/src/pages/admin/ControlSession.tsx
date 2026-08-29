import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { usePresentationSocket } from '../../usePresentationSocket';
import type { Session, ControlState } from '../../types';
import { mockParticipants } from '../../lib/mockParticipants';
import { liveAggregate, streamMetrics } from '../../lib/metrics';

export default function ControlSession() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [cs, setCs] = useState<ControlState | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const { event, stats, connected } = usePresentationSocket(code);
  const prevScore = useRef<number>(0);

  const loadSession = useCallback(() => {
    if (!code) return;
    api.getSession(code).then(setSession).catch(() => setErr('Session not found'));
  }, [code]);
  useEffect(loadSession, [loadSession]);

  const loadControl = useCallback(() => {
    if (!code) return;
    api.controlState(code).then(setCs).catch(() => setCs(null));
  }, [code]);
  useEffect(loadControl, [loadControl]);

  useEffect(() => {
    if (event?.type === 'SLIDE_CHANGED') loadControl();
  }, [event, loadControl]);

  const run = async (fn: () => Promise<Session>) => {
    setErr('');
    setBusy(true);
    try {
      const s = await fn();
      setSession(s);
      loadControl();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.sessionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  if (!session) {
    return (
      <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted p-10 text-center">
        {'>'} Loading_Session
      </div>
    );
  }

  const current = session.currentSlideNumber ?? 0;
  const max = session.slideCount;
  const slide = event?.type === 'SLIDE_CHANGED' ? event.slide : undefined;
  const participantCount = stats?.participantCount ?? cs?.participantCount ?? 0;
  const currentResponses = stats?.currentSlideResponseCount ?? cs?.currentSlideResponseCount ?? 0;
  const score = liveAggregate(participantCount, currentResponses);
  const variance = score - prevScore.current;
  prevScore.current = score;
  const stream = streamMetrics(participantCount, currentResponses, []);
  const participants = mockParticipants(participantCount, session.sessionCode);

  const StatusPill = () => {
    if (session.status === 'live') {
      return (
        <span className="status-pill status-pill-live">
          <span className="w-1.5 h-1.5 bg-primary rounded-full pulse-emerald inline-block" />
          Live_Executor
        </span>
      );
    }
    if (session.status === 'ended') return <span className="status-pill status-pill-ended">Ended</span>;
    return <span className="status-pill status-pill-draft">Draft</span>;
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <StatusPill />
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              [Control_Room]
            </span>
          </div>
          <h1 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface">
            {session.presentationTitle}
          </h1>
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
            {max} Slides &nbsp;·&nbsp; {participantCount} Nodes &nbsp;·&nbsp; WS: {connected ? 'Online' : 'Reconnecting...'}
          </p>
        </div>
        <div className="border border-border bg-surface px-3 py-2">
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Code]</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-session-code text-on-surface">{session.sessionCode}</span>
            <button
              onClick={copy}
              className="text-muted hover:text-primary transition p-1"
              title="Copy"
            >
              <span className="material-symbols-outlined text-[16px]">
                {copied ? 'check' : 'content_copy'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div className="term-card border-danger bg-[#fef2f2] px-4 py-3 font-mono text-micro uppercase tracking-[0.15em] text-danger mb-4">
          {'>'} {err}
        </div>
      )}

      {session.status === 'draft' && (
        <div className="term-card">
          <div className="px-5 py-8 text-center">
            <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Pre-Flight]</div>
            <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-2">
              Session Ready
            </h2>
            <p className="font-body text-body text-on-surface-variant max-w-md mx-auto mt-2 mb-6">
              Participants can join the lobby using the code below, but they will not see the presentation until you go live.
            </p>
            <div className="flex justify-center mb-6">
              <div className="border border-border bg-surface-1 px-8 py-4 inline-block">
                <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Join_Code]</div>
                <div className="font-mono text-[2rem] text-on-surface mt-1">{session.sessionCode}</div>
              </div>
            </div>
            <button
              onClick={() => run(() => api.startSession(code!))}
              disabled={busy}
              className="term-button-primary !px-8 !py-3 mx-auto"
            >
              <span className="material-symbols-outlined text-[18px]">sensors</span>
              {busy ? 'Starting...' : 'Go_Live'}
            </button>
          </div>
        </div>
      )}

      {session.status === 'live' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-px bg-border border border-border">
          <div className="lg:col-span-8 bg-surface p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <StatusPill />
              <button
                onClick={() => run(() => api.endSession(code!))}
                disabled={busy}
                className="term-button-danger !py-2 !px-3"
              >
                <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
                End_Presentation
              </button>
            </div>

            <div className="border border-border">
              <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                  [Current_Slide]
                </span>
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-on-surface">
                  {String(current).padStart(2, '0')} / {String(max).padStart(2, '0')}
                </span>
              </div>
              <div className="bg-surface-1 aspect-video flex flex-col items-center justify-center text-center p-6">
                {slide?.title ? (
                  <h3 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mb-2">
                    {slide.title}
                  </h3>
                ) : (
                  <h3 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mb-2">
                    Slide {String(current).padStart(2, '0')}
                  </h3>
                )}
                {slide?.summary ? (
                  <p className="font-body text-body text-on-surface-variant max-w-2xl">{slide.summary}</p>
                ) : (
                  <p className="font-mono text-body text-muted">No_Content</p>
                )}
              </div>
              <div className="border-t border-border p-3 flex items-center justify-between gap-4">
                <button
                  onClick={() => run(() => api.changeSlide(code!, Math.max(1, current - 1)))}
                  disabled={busy || current <= 1}
                  className="px-3 py-2 font-mono text-label uppercase tracking-[0.15em] text-on-surface hover:text-primary disabled:opacity-40 inline-flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                  Previous
                </button>
                <div className="flex-1 px-4">
                  <div className="h-2 bg-surface-1 border border-border">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${max ? (current / max) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => run(() => api.changeSlide(code!, Math.min(max, current + 1)))}
                  disabled={busy || current >= max}
                  className="px-3 py-2 font-mono text-label uppercase tracking-[0.15em] text-on-surface hover:text-primary disabled:opacity-40 inline-flex items-center gap-1"
                >
                  Next
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link to={`/admin/sessions/${code}/results`} className="term-button-secondary">
                <span className="material-symbols-outlined text-[16px]">analytics</span>
                View_Results / Export
              </Link>
            </div>
          </div>

          <div className="lg:col-span-4 bg-surface p-5 flex flex-col gap-4">
            <div className="border border-border">
              <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Live_Aggregate]</span>
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">Mode: 01-10</span>
              </div>
              <div className="px-4 py-5 text-center">
                <div className="font-mono text-[4rem] leading-none text-on-surface">{score}</div>
                <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
                  / 100 Score
                </div>
                <div className={`font-mono text-micro uppercase tracking-[0.18em] mt-2 ${variance >= 0 ? 'text-primary' : 'text-danger'}`}>
                  {variance >= 0 ? '>' : '<'} {Math.abs(variance)}% Variance
                </div>
              </div>
            </div>

            <div className="border border-border">
              <div className="border-b border-border px-4 py-2">
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Real-Time_Feedback]</span>
              </div>
              <div className="p-3 grid grid-cols-2 gap-px bg-border border-t-0">
                {[
                  { label: 'Response', value: stream.response, color: 'bg-primary' },
                  { label: 'Sync', value: stream.sync, color: 'bg-primary' },
                  { label: 'Average', value: stream.average, color: 'bg-info' },
                  { label: 'Time', value: stream.time, color: 'bg-warning' },
                ].map((m) => (
                  <div key={m.label} className="bg-surface p-3">
                    <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                      {m.label}
                    </div>
                    <div className="font-mono text-display-sm text-on-surface mt-1">{m.value}</div>
                    <div className="mt-2 h-1 bg-surface-1 border border-border overflow-hidden">
                      <div className={`h-full ${m.color}`} style={{ width: `${Math.min(100, m.value)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-border">
              <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Lobby_Counters]</span>
                <span className={`flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.18em] ${connected ? 'text-primary' : 'text-warning'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full inline-block ${connected ? 'bg-primary pulse-emerald' : 'bg-warning pulse-emerald'}`} />
                  {connected ? 'Online' : 'Reconnecting'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-px bg-border">
                <div className="bg-surface p-3">
                  <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">Joined</div>
                  <div className="font-mono text-display-sm text-on-surface">{participantCount}</div>
                </div>
                <div className="bg-surface p-3">
                  <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">Responses</div>
                  <div className="font-mono text-display-sm text-on-surface">{currentResponses}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {session.status === 'live' && (
        <div className="mt-6 term-card">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              [Participant_Node_Activity]
            </span>
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              {participants.length} / {participantCount} Entries
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-1 text-left font-mono text-micro uppercase tracking-[0.18em] text-muted">
                  <th className="px-3 py-2 border-b border-border">Node_Id</th>
                  <th className="px-3 py-2 border-b border-border">Role</th>
                  <th className="px-3 py-2 border-b border-border">Score</th>
                  <th className="px-3 py-2 border-b border-border">Status</th>
                  <th className="px-3 py-2 border-b border-border">Last_Seen</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.id} className="term-table-row">
                    <td className="px-3 py-2 font-mono text-body text-on-surface">{p.id}</td>
                    <td className="px-3 py-2 font-mono text-body text-on-surface-variant">{p.role}</td>
                    <td className="px-3 py-2 font-mono text-body text-on-surface">
                      <div className="flex items-center gap-2">
                        <span>{p.score}</span>
                        <div className="w-12 h-1 bg-surface-1 border border-border">
                          <div className="h-full bg-primary" style={{ width: `${p.score}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`status-pill ${
                          p.status === 'COMPLETE'
                            ? 'status-pill-live'
                            : p.status === 'INCOMPLETE'
                              ? 'status-pill-draft'
                              : 'status-pill-ended'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-micro uppercase tracking-[0.18em] text-muted">
                      {new Date(p.joinedAt).toISOString().slice(11, 19)}Z
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {session.status === 'ended' && (
        <div className="term-card text-center px-5 py-10">
          <span className="material-symbols-outlined text-4xl text-danger">stop_circle</span>
          <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-3">
            Session_Ended
          </h2>
          <p className="font-body text-body text-on-surface-variant mt-1 mb-6">
            This feedback session is closed.
          </p>
          <div className="flex justify-center gap-2">
            <Link to={`/admin/sessions/${code}/results`} className="term-button-primary">
              <span className="material-symbols-outlined text-[16px]">analytics</span>
              View_Results &amp; Export
            </Link>
            <Link to="/admin/presentations" className="term-button-secondary">
              Back_To_Library
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
