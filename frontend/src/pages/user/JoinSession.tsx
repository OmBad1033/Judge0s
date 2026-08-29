import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api';

// Judge OS participant join — replicates the `JUDGE_OS: Participant Join` Stitch screen.
// Mobile-narrow centered layout, but works on desktop too.
export default function JoinSession() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api.joinSession(code, name, email);
      localStorage.setItem('participant', JSON.stringify({ participantId: r.participantId, code: r.sessionCode }));
      navigate(`/session/${r.sessionCode}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Join failed';
      setErr(
        msg === 'SESSION_ENDED'
          ? 'This session has ended.'
          : msg === 'NOT_FOUND'
            ? 'No session with that code.'
            : msg
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dot-grid min-h-screen text-on-surface font-body flex flex-col">
      {/* Top status strip */}
      <div className="border-b border-border bg-surface">
        <div className="max-w-md mx-auto px-4 h-12 flex items-center justify-between">
          <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
            <span className="material-symbols-outlined text-[14px] align-middle mr-1">grid_view</span>
            Participant_Node
          </span>
          <span className="flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.18em] text-primary">
            <span className="w-1.5 h-1.5 bg-primary rounded-full pulse-emerald inline-block" />
            System_Online
          </span>
        </div>
      </div>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
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
                  className="term-input px-3 py-2.5"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your designated identifier"
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
                  className="term-input px-3 py-2.5"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
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
                  className="term-input px-3 py-3 text-center font-mono text-h1 uppercase tracking-[0.3em]"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="------"
                  required
                />
              </div>

              {err && (
                <div className="flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.15em] text-danger">
                  <span className="material-symbols-outlined text-[14px] fill">error</span>
                  <span>{err}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="term-button-primary w-full !py-3 mt-2"
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

          <div className="text-center mt-4 font-mono text-micro uppercase tracking-[0.18em] text-muted">
            <a href="/" className="hover:text-on-surface">{'< Back to Landing'}</a>
          </div>
        </div>
      </main>
    </div>
  );
}
