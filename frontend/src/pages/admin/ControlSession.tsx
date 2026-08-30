import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api';
import { usePresentationSocket } from '../../usePresentationSocket';
import type { Session, ControlState, SessionParticipant } from '../../types';
import { liveAggregate } from '../../lib/metrics';
import { useToast } from '../../lib/toast';
import ConnectionStatus from '../../components/ConnectionStatus';
import SessionQRCode from '../../components/SessionQRCode';
import Skeleton from '../../components/Skeleton';

// Admin's "remote control" for a live session. Mobile-first by default:
//   • Big bottom-anchored Prev/Next/Pause/End bar
//   • Single-column on phones; multi-column on lg+
//   • Slide picker for non-linear control (no more tap-tap-tap to slide 30)
//   • Live stats sheet pulls real data (FR-3) when available, falls back gracefully
export default function ControlSession() {
  const { code } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showSlidePicker, setShowSlidePicker] = useState(false);
  const [copied, setCopied] = useState(false);
  const { event, stats, statsV2, connected } = usePresentationSocket(code);
  const queryKey = ['control-state', code];

  const sessionQ = useQuery({
    queryKey: ['session', code],
    queryFn: () => api.getSession(code!),
    enabled: !!code,
    refetchInterval: 15_000,
  });

  const controlQ = useQuery({
    queryKey,
    queryFn: () => api.controlState(code!),
    enabled: !!code,
  });

  // Refresh the control state when the active slide changes via WS.
  useEffect(() => {
    if (event?.type === 'SLIDE_CHANGED') {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['participants', code] });
    }
  }, [event, queryClient, queryKey, code]);

  // Keep local session in sync with the query.
  useEffect(() => {
    if (sessionQ.data) setSession(sessionQ.data);
  }, [sessionQ.data]);

  const startMut = useMutation({
    mutationFn: () => api.startSession(code!),
    onSuccess: (s) => {
      setSession(s);
      queryClient.invalidateQueries({ queryKey: ['session', code] });
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Start failed'),
  });

  const endMut = useMutation({
    mutationFn: () => api.endSession(code!),
    onSuccess: (s) => {
      setSession(s);
      queryClient.invalidateQueries({ queryKey: ['session', code] });
      queryClient.invalidateQueries({ queryKey });
      toast.push('info', 'Session ended.');
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'End failed'),
  });

  const slideMut = useMutation({
    mutationFn: (n: number) => api.changeSlide(code!, n),
    onSuccess: (s) => {
      setSession(s);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Slide change failed'),
  });

  const pauseMut = useMutation({
    mutationFn: () => api.pauseSession(code!),
    onSuccess: (s) => {
      setSession(s);
      toast.push('warning', 'Session paused.');
    },
    onError: (e) => {
      // 404 / 409 silently on this one — backend may not have shipped FR-4 yet.
      if (!(e instanceof ApiError)) setErr('Pause failed');
    },
  });

  const resumeMut = useMutation({
    mutationFn: () => api.resumeSession(code!),
    onSuccess: (s) => {
      setSession(s);
      toast.push('success', 'Session resumed.');
    },
    onError: (e) => {
      if (!(e instanceof ApiError)) setErr('Resume failed');
    },
  });

  const participantsQ = useQuery({
    queryKey: ['participants', code],
    queryFn: () => api.listSessionParticipants(code!),
    enabled: !!code && session?.status === 'live',
    // FR-5 — backend not shipped yet returns 404; fall back to empty list silently.
    retry: false,
    refetchInterval: 10_000,
  });

  const copyCode = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.sessionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.push('success', 'Code copied');
    } catch {
      toast.push('error', 'Copy failed');
    }
  };

  const shareLink = async () => {
    if (!session || !code) return;
    const url = `${window.location.origin}/join/${encodeURIComponent(code)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: session.presentationTitle, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.push('success', 'Link copied');
      }
    } catch {
      /* user cancelled */
    }
  };

  if (sessionQ.isLoading || !session) {
    return (
      <div className="px-4 py-6">
        <Skeleton variant="card" />
        <div className="h-4" />
        <Skeleton variant="card" rows={4} />
      </div>
    );
  }

  if (sessionQ.error) {
    return (
      <div className="term-card p-6 text-center font-mono text-micro uppercase tracking-[0.15em] text-danger">
        Session not found.
      </div>
    );
  }

  const current = session.currentSlideNumber ?? 0;
  const max = session.slideCount;
  const slide = event?.type === 'SLIDE_CHANGED' ? event.slide : undefined;
  const participantCount = stats?.participantCount ?? controlQ.data?.participantCount ?? 0;
  const currentResponses = stats?.currentSlideResponseCount ?? controlQ.data?.currentSlideResponseCount ?? 0;
  const score = liveAggregate(participantCount, currentResponses);

  const isLive = session.status === 'live';
  const isDraft = session.status === 'draft';
  const isEnded = session.status === 'ended';
  const isPaused = session.status === 'paused';

  const StatusPill = () => {
    if (isLive)
      return (
        <span className="status-pill status-pill-live">
          <span className="w-1.5 h-1.5 bg-primary rounded-full pulse-emerald inline-block" />
          Live_Executor
        </span>
      );
    if (isPaused)
      return (
        <span className="status-pill status-pill-draft">
          <span className="w-1.5 h-1.5 bg-warning rounded-full inline-block" />
          Paused
        </span>
      );
    if (isEnded) return <span className="status-pill status-pill-ended">Ended</span>;
    return <span className="status-pill status-pill-draft">Draft</span>;
  };

  return (
    <div className="pb-32 lg:pb-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4 mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <StatusPill />
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              [Control_Room]
            </span>
          </div>
          <h1 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface truncate">
            {session.presentationTitle}
          </h1>
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
            {max} Slides &nbsp;·&nbsp; {participantCount} Nodes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionStatus state={connected ? 'connected' : 'reconnecting'} size="md" />
          <button onClick={copyCode} className="border border-border bg-surface px-3 py-2 inline-flex items-center gap-2 min-h-[44px]">
            <div className="text-left">
              <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Code]</div>
              <div className="font-mono text-h1 text-on-surface leading-none">{session.sessionCode}</div>
            </div>
            <span className="material-symbols-outlined text-[18px] text-muted">
              {copied ? 'check' : 'content_copy'}
            </span>
          </button>
          {(isLive || isPaused) && (
            <button
              onClick={() => endMut.mutate()}
              disabled={endMut.isPending}
              className="term-button-danger min-h-[44px] hidden lg:inline-flex"
              aria-label="End session"
            >
              <span className="material-symbols-outlined text-[18px]">stop</span>
              <span>End_Session</span>
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="term-card border-danger bg-[#fef2f2] px-4 py-3 font-mono text-micro uppercase tracking-[0.15em] text-danger mb-4">
          {'>'} {err}
        </div>
      )}

      {/* DRAFT — LOBBY */}
      {isDraft && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="term-card">
            <div className="px-5 py-6 text-center">
              <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Pre-Flight]</div>
              <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-2">
                Session Ready
              </h2>
              <p className="font-body text-body text-on-surface-variant max-w-md mx-auto mt-2 mb-6">
                Participants can join the lobby using the code below. They won't see the presentation
                until you go live.
              </p>
              <button
                onClick={() => startMut.mutate()}
                disabled={startMut.isPending}
                className="term-button-primary !px-8 !py-3.5 min-h-[48px] mx-auto"
              >
                <span className="material-symbols-outlined text-[18px]">sensors</span>
                {startMut.isPending ? 'Starting...' : 'Go_Live'}
              </button>
            </div>
          </div>

          <div className="term-card p-5 flex flex-col items-center justify-center gap-3">
            <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              [Share_With_Participants]
            </div>
            <SessionQRCode code={session.sessionCode} size={180} />
            <button onClick={shareLink} className="term-button-secondary">
              <span className="material-symbols-outlined text-[16px]">share</span>
              <span>Share_Link</span>
            </button>
          </div>
        </div>
      )}

      {/* LIVE / PAUSED */}
      {(isLive || isPaused) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT — slide + stats */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            <div className="term-card">
              <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                  [Current_Slide]
                </span>
                <button
                  onClick={() => setShowSlidePicker((v) => !v)}
                  className="font-mono text-micro uppercase tracking-[0.18em] text-on-surface hover:text-primary inline-flex items-center gap-1 min-h-[36px] px-2"
                >
                  <span>
                    {String(current).padStart(2, '0')} / {String(max).padStart(2, '0')}
                  </span>
                  <span className="material-symbols-outlined text-[16px]">
                    {showSlidePicker ? 'expand_less' : 'expand_more'}
                  </span>
                </button>
              </div>

              {showSlidePicker && (
                <SlidePicker
                  max={max}
                  current={current}
                  slides={controlQ.data?.slides ?? []}
                  onPick={(n) => {
                    slideMut.mutate(n);
                    setShowSlidePicker(false);
                  }}
                />
              )}

              <div className="relative bg-surface-1">
                <button
                  onClick={() => slideMut.mutate(Math.max(1, current - 1))}
                  disabled={busy || current <= 1}
                  className="hidden lg:flex absolute left-2 top-1/2 -translate-y-1/2 z-10 border border-border bg-surface/90 hover:bg-surface min-h-[44px] min-w-[44px] items-center justify-center"
                  aria-label="Previous slide"
                >
                  <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                </button>
                <button
                  onClick={() => slideMut.mutate(Math.min(max, current + 1))}
                  disabled={busy || current >= max}
                  className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 z-10 border border-border bg-surface/90 hover:bg-surface min-h-[44px] min-w-[44px] items-center justify-center"
                  aria-label="Next slide"
                >
                  <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                </button>
                <div className="aspect-video flex flex-col items-center justify-center text-center p-6">
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
              </div>

              {/* Progress bar (desktop only — mobile uses the bottom-anchored controls). */}
              <div className="hidden lg:block border-t border-border p-3">
                <div className="h-2 bg-surface-1 border border-border">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${max ? (current / max) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Live stats — desktop always-on, mobile collapsible. */}
            <div className={`term-card ${showStats ? '' : 'hidden lg:block'}`}>
              <button
                onClick={() => setShowStats((v) => !v)}
                className="lg:cursor-default border-b border-border px-4 py-2 w-full flex items-center justify-between min-h-[40px]"
              >
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                  [Live_Stats]
                </span>
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted lg:hidden">
                  {showStats ? 'Hide' : 'Show'}
                </span>
              </button>

              <div className="p-4 grid grid-cols-2 gap-3">
                <Stat label="Engagement" value={`${score}%`} sub={`${currentResponses}/${participantCount} responses`} />
                <Stat
                  label="Participants"
                  value={String(participantCount)}
                  sub={connected ? 'Live' : 'Reconnecting'}
                />
              </div>

              {statsV2?.currentSlide?.fieldBreakdown && statsV2.currentSlide.fieldBreakdown.length > 0 && (
                <div className="border-t border-border p-4">
                  <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mb-2">
                    [Field_Breakdown]
                  </div>
                  <div className="flex flex-col gap-3">
                    {statsV2.currentSlide.fieldBreakdown.map((f, i) => (
                      <FieldBreakdown key={i} field={f} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="hidden lg:flex items-center gap-2">
              <Link to={`/admin/sessions/${code}/results`} className="term-button-secondary">
                <span className="material-symbols-outlined text-[16px]">analytics</span>
                View_Results / Export
              </Link>
            </div>
          </div>

          {/* RIGHT — participant table (desktop only) */}
          <div className="hidden lg:block lg:col-span-4">
            <ParticipantList
              participants={participantsQ.data?.participants ?? []}
              participantCount={participantCount}
              loading={participantsQ.isLoading}
              isMock={participantsQ.isError}
            />
          </div>
        </div>
      )}

      {/* ENDED */}
      {isEnded && (
        <div className="term-card text-center px-5 py-10">
          <span className="material-symbols-outlined text-4xl text-danger">stop_circle</span>
          <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-3">
            Session_Ended
          </h2>
          <p className="font-body text-body text-on-surface-variant mt-1 mb-6">
            This feedback session is closed.
          </p>
          <div className="flex justify-center gap-2 flex-wrap">
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

      {/* MOBILE — bottom-anchored remote control bar (visible for live / paused). */}
      {(isLive || isPaused) && (
        <div
          className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-surface border-t border-border px-3 pt-2"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
        >
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => slideMut.mutate(Math.max(1, current - 1))}
              disabled={busy || current <= 1}
              className="term-button-secondary !py-3 min-h-[52px] !px-2"
              aria-label="Previous slide"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              <span className="hidden sm:inline">Prev</span>
            </button>
            <button
              onClick={() => slideMut.mutate(Math.min(max, current + 1))}
              disabled={busy || current >= max}
              className="term-button-primary !py-3 min-h-[52px] !px-2"
              aria-label="Next slide"
            >
              <span className="hidden sm:inline">Next</span>
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
            {isPaused ? (
              <button
                onClick={() => resumeMut.mutate()}
                disabled={resumeMut.isPending}
                className="term-button-secondary !py-3 min-h-[52px]"
                aria-label="Resume session"
              >
                <span className="material-symbols-outlined text-[18px]">play_arrow</span>
              </button>
            ) : (
              <button
                onClick={() => pauseMut.mutate()}
                disabled={pauseMut.isPending}
                className="term-button-secondary !py-3 min-h-[52px]"
                aria-label="Pause session"
              >
                <span className="material-symbols-outlined text-[18px]">pause</span>
              </button>
            )}
            <button
              onClick={() => endMut.mutate()}
              disabled={endMut.isPending}
              className="term-button-danger !py-3 min-h-[52px] !px-2"
              aria-label="End session"
            >
              <span className="material-symbols-outlined text-[18px]">stop</span>
              <span className="hidden sm:inline">End</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Local helpers
// ============================================================================

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border bg-surface-1 px-3 py-2">
      <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="font-mono text-display-sm text-on-surface mt-1">{value}</div>
      {sub && (
        <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-0.5">{sub}</div>
      )}
    </div>
  );
}

function FieldBreakdown({
  field,
}: {
  field:
    | { fieldId: string; feedbackType: 'boolean' | 'multiple_choice' | 'open_text'; counts: Record<string, number> }
    | { fieldId: string; questionType: 'interested' | 'rating'; average: number; count: number };
}) {
  // Discriminator — `feedbackType` for slide-rule fields, `questionType` for default questions.
  if ('feedbackType' in field) {
    const total = Object.values(field.counts).reduce((a, b) => a + b, 0) || 1;
    const entries = Object.entries(field.counts).sort(([, a], [, b]) => b - a);
    return (
      <div>
        <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mb-1">
          {field.feedbackType}
        </div>
        <div className="flex flex-col gap-1.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="font-mono text-label text-on-surface min-w-[120px] truncate">{k}</span>
              <div className="flex-1 h-2 bg-surface-2 border border-border overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${(v / total) * 100}%` }} />
              </div>
              <span className="font-mono text-label text-muted">{v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mb-1">
        {field.questionType}
      </div>
      <div className="font-mono text-display-sm text-on-surface">
        {field.average.toFixed(1)}{' '}
        <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">avg</span>
        <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted ml-2">
          ({field.count} responses)
        </span>
      </div>
    </div>
  );
}

function SlidePicker({
  max,
  current,
  slides,
  onPick,
}: {
  max: number;
  current: number;
  slides: { slideNumber: number; configured: boolean; title: string | null }[];
  onPick: (n: number) => void;
}) {
  return (
    <div className="border-b border-border bg-surface-1 p-2 max-h-64 overflow-y-auto">
      <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5">
        {Array.from({ length: max }).map((_, i) => {
          const n = i + 1;
          const meta = slides.find((s) => s.slideNumber === n);
          const active = n === current;
          const configured = meta?.configured ?? false;
          return (
            <button
              key={n}
              onClick={() => onPick(n)}
              className={`font-mono text-label uppercase tracking-[0.15em] py-2 border ${
                active
                  ? 'border-primary bg-primary-dim text-primary'
                  : configured
                    ? 'border-border bg-surface text-on-surface hover:border-primary'
                    : 'border-border bg-surface text-muted hover:border-primary'
              }`}
            >
              {String(n).padStart(2, '0')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ParticipantList({
  participants,
  participantCount,
  loading,
  isMock,
}: {
  participants: SessionParticipant[];
  participantCount: number;
  loading: boolean;
  isMock: boolean;
}) {
  if (loading) {
    return (
      <div className="term-card p-4">
        <Skeleton variant="list" rows={4} />
      </div>
    );
  }

  if (isMock || participants.length === 0) {
    return (
      <div className="term-card p-4 flex flex-col items-center justify-center text-center gap-2 min-h-[180px]">
        <span className="material-symbols-outlined text-3xl text-muted">group</span>
        <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
          Waiting for participants to join
        </p>
        <p className="font-mono text-label text-on-surface">{participantCount} connected</p>
      </div>
    );
  }

  return (
    <div className="term-card">
      <div className="border-b border-border px-4 py-2 flex items-center justify-between">
        <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
          [Participants]
        </span>
        <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
          {participants.length} / {participantCount}
        </span>
      </div>
      <ul className="divide-y divide-border max-h-96 overflow-y-auto">
        {participants.map((p) => (
          <li key={p.id} className="px-3 py-2 flex items-center gap-2">
            <span className="w-2 h-2 bg-primary rounded-full" aria-hidden />
            <span className="font-mono text-body text-on-surface truncate flex-1">{p.name}</span>
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              {p.totalResponses} resp
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}