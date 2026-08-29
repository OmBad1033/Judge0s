import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api';
import Skeleton from '../../components/Skeleton';
import ConnectionStatus from '../../components/ConnectionStatus';

// Mobile-first participant join. Two entry points:
//   • /join           — manual code entry (empty form)
//   • /join/:code     — deep-link from QR / shared URL (code pre-filled, session pre-validated)
export default function JoinSession() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { code: codeParam } = useParams<{ code?: string }>();
  const initialCode = codeParam ?? params.get('code') ?? '';
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // FR-1 — when a code is present, look up session info to render the right state.
  const trimmedCode = code.trim().toUpperCase();
  const queryClient = useQueryClient();
  const infoQuery = useQuery({
    queryKey: ['join-info', trimmedCode],
    queryFn: () => api.getJoinInfo(trimmedCode),
    enabled: trimmedCode.length >= 4,
    retry: false,
    staleTime: 30_000,
  });

  // Helper to clear the join-info lookup when the user starts over.
  const resetCode = () => {
    setCode('');
    // Removing the cached entry forces a refetch the next time a code is entered.
    queryClient.removeQueries({ queryKey: ['join-info'] });
    navigate('/join', { replace: true });
  };

  useEffect(() => {
    if (codeParam) setCode(codeParam.toUpperCase());
  }, [codeParam]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api.joinSession(trimmedCode, name, email);
      localStorage.setItem(
        'participant',
        JSON.stringify({ participantId: r.participantId, code: r.sessionCode }),
      );
      navigate(`/session/${r.sessionCode}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Join failed';
      setErr(
        msg === 'SESSION_ENDED'
          ? 'This session has ended.'
          : msg === 'NOT_FOUND'
            ? 'No session with that code.'
            : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const sessionEnded = infoQuery.data?.status === 'ended';
  const sessionDraft = infoQuery.data?.status === 'draft';
  const sessionLive = infoQuery.data?.status === 'live';
  const notFound = infoQuery.error instanceof ApiError && infoQuery.error.status === 404;

  return (
    <div className="dot-grid min-h-screen text-on-surface font-body flex flex-col">
      {/* Top status strip */}
      <div className="border-b border-border bg-surface">
        <div className="max-w-md mx-auto px-4 h-12 flex items-center justify-between">
          <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
            <span className="material-symbols-outlined text-[14px] align-middle mr-1">grid_view</span>
            Participant_Node
          </span>
          <ConnectionStatus state="connected" size="sm" showLabel={false} />
        </div>
      </div>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Deep-link outcome: session ended */}
          {sessionEnded && (
            <div className="term-card p-6 flex flex-col gap-4 text-center">
              <span className="material-symbols-outlined text-4xl text-danger mx-auto">stop_circle</span>
              <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em]">Session_Ended</h2>
              <p className="font-body text-body text-on-surface-variant">
                <span className="font-mono font-semibold">{trimmedCode}</span> has already ended. Ask the
                host to start a new session.
              </p>
              <button
                onClick={resetCode}
                className="term-button-secondary w-full !py-3"
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                <span>Try_Another_Code</span>
              </button>
            </div>
          )}

          {/* Deep-link outcome: code not found */}
          {notFound && (
            <div className="term-card p-6 flex flex-col gap-4 text-center">
              <span className="material-symbols-outlined text-4xl text-warning mx-auto">help</span>
              <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em]">Code_Not_Found</h2>
              <p className="font-body text-body text-on-surface-variant">
                We couldn't find a session with the code{' '}
                <span className="font-mono font-semibold">{trimmedCode}</span>. Double-check the code with
                the host.
              </p>
              <button
                onClick={resetCode}
                className="term-button-secondary w-full !py-3"
              >
                <span className="material-symbols-outlined text-[18px]">edit</span>
                <span>Enter_Code_Manually</span>
              </button>
            </div>
          )}

          {/* Session is in draft — show a hint above the form */}
          {sessionDraft && (
            <div className="term-card border-warning bg-[#fef3c7] px-3 py-2 mb-3 flex items-center gap-2 text-warning">
              <span className="material-symbols-outlined text-[18px]">hourglass_top</span>
              <span className="font-mono text-micro uppercase tracking-[0.15em]">
                Session is set up but the host hasn't started yet. You can join now and wait.
              </span>
            </div>
          )}

          {/* Session is live — show a friendly indicator */}
          {sessionLive && (
            <div className="term-card border-primary bg-primary-dim px-3 py-2 mb-3 flex items-center gap-2 text-primary">
              <span className="w-1.5 h-1.5 bg-primary rounded-full pulse-emerald inline-block" />
              <span className="font-mono text-micro uppercase tracking-[0.15em]">
                Session is live. Enter your details to join.
              </span>
            </div>
          )}

          {/* Main join form (always rendered unless session ended / not found) */}
          {!sessionEnded && !notFound && (
            <div className="term-card">
              <div className="border-b border-border px-6 py-5 text-center">
                <div className="font-mono text-display-sm uppercase tracking-[0.15em] text-on-surface">
                  Judge_OS
                </div>
                <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
                  [Participant_Access_Protocol]
                </div>
              </div>

              <form className="px-6 py-6 flex flex-col gap-5" onSubmit={submit} noValidate>
                <div>
                  <label className="term-label block mb-1.5" htmlFor="participantName">
                    Participant_Name
                  </label>
                  <input
                    id="participantName"
                    className="term-input px-3 py-2.5 min-h-[44px]"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your designated identifier"
                    autoComplete="name"
                    required
                  />
                </div>

                <div>
                  <label className="term-label block mb-1.5" htmlFor="participantEmail">
                    Email_Address
                  </label>
                  <input
                    id="participantEmail"
                    type="email"
                    className="term-input px-3 py-2.5 min-h-[44px]"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    inputMode="email"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="term-label" htmlFor="sessionCode">
                      Session_Code
                    </label>
                    <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                      6 Characters
                    </span>
                  </div>
                  <input
                    id="sessionCode"
                    autoComplete="off"
                    className="term-input px-3 py-3 text-center font-mono text-h1 uppercase tracking-[0.3em] min-h-[48px]"
                    maxLength={6}
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                      // Removing the cached join-info entry forces a refetch for the new code.
                      queryClient.removeQueries({ queryKey: ['join-info'] });
                    }}
                    placeholder="------"
                    inputMode="text"
                    autoCapitalize="characters"
                    required
                  />
                  {infoQuery.isLoading && trimmedCode.length >= 4 && (
                    <div className="mt-2">
                      <Skeleton rows={1} />
                    </div>
                  )}
                </div>

                {err && (
                  <div className="flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.15em] text-danger">
                    <span className="material-symbols-outlined text-[14px] fill">error</span>
                    <span>{err}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy || !trimmedCode || !name || !email}
                  className="term-button-primary w-full !py-3.5 mt-2 min-h-[48px]"
                >
                  {busy ? (
                    <>
                      <span>{'>'}</span>
                      Authenticating
                      <span className="cursor-blink">_</span>
                    </>
                  ) : (
                    <>
                      <span>{'>'}</span>
                      Join_Session
                      <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </>
                  )}
                </button>
              </form>

              <div className="border-t border-border px-6 py-3 flex items-center justify-between font-mono text-micro uppercase tracking-[0.18em] text-muted">
                <span>V2.0.4 - Stable</span>
                <span>Secure Connection</span>
              </div>
            </div>
          )}

          <div className="text-center mt-4 font-mono text-micro uppercase tracking-[0.18em] text-muted">
            <a href="/" className="hover:text-on-surface">
              {'< Back to Landing'}
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}