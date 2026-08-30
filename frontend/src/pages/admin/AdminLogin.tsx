import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google/start';
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.adminLogin(password);
      navigate('/admin/presentations');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dot-grid min-h-screen text-on-surface font-body flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="term-card">
          {/* Header */}
          <div className="border-b border-border px-6 py-5 flex flex-col items-center gap-1 text-center">
            <div className="flex items-center gap-2 font-mono text-display-sm uppercase tracking-[0.15em] text-on-surface">
              <span>Judge_OS</span>
            </div>
            <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              [OAuth_Authentication]
            </div>
          </div>

          <div className="px-6 py-6 flex flex-col gap-5">
            {/* Primary Google OAuth Login */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="term-button-primary w-full !py-3 flex items-center justify-center gap-3 text-label"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Login with Google</span>
            </button>

            {/* Toggle legacy fallback */}
            <div className="pt-2 border-t border-border flex justify-center">
              <button
                type="button"
                onClick={() => setShowLegacy(!showLegacy)}
                className="font-mono text-micro uppercase tracking-[0.18em] text-muted hover:text-on-surface transition"
              >
                {showLegacy ? '[-] Hide System Key' : '[+] Enter System Key'}
              </button>
            </div>

            {/* Legacy Form */}
            {showLegacy && (
              <form className="flex flex-col gap-4 pt-2" onSubmit={submit}>
                <div>
                  <label className="font-mono text-micro uppercase tracking-[0.18em] text-muted block mb-1.5">
                    Auth_Key
                  </label>
                  <div className="relative">
                    <input
                      className={`term-input px-3 py-2.5 pr-10 ${
                        err ? 'border-danger focus:border-danger focus:ring-danger' : ''
                      }`}
                      type={show ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter system auth key"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShow((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-on-surface px-1"
                      title={show ? 'Hide' : 'Show'}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {show ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                  {err && (
                    <div className="flex items-center gap-1.5 mt-2 font-mono text-micro uppercase tracking-[0.15em] text-danger">
                      <span className="material-symbols-outlined text-[14px] fill">error</span>
                      <span>{err}</span>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="term-button-secondary w-full !py-2.5"
                >
                  {busy ? 'Authenticating...' : 'Submit Key'}
                </button>
              </form>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-6 py-3 text-center font-mono text-micro uppercase tracking-[0.18em] text-muted">
            Secure Connection Established. v2.0.4
          </div>
        </div>

        <div className="text-center mt-4 font-mono text-micro uppercase tracking-[0.18em] text-muted">
          <a href="/" className="hover:text-on-surface">{'< Back to Landing'}</a>
        </div>
      </div>
    </div>
  );
}
