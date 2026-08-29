import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api';

// Judge OS admin login — replicates the `JUDGE_OS: Admin Login` Stitch screen.
// Submits the existing admin password; backend's joinSchema doesn't ask for an
// admin_id so we send only the password.
export default function AdminLogin() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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
              [System_Access]
            </div>
          </div>

          {/* Form */}
          <form className="px-6 py-6 flex flex-col gap-5" onSubmit={submit}>
            <div>
              <label className="font-mono text-micro uppercase tracking-[0.18em] text-muted block mb-1.5">
                Admin_Id
              </label>
              <input
                className="term-input px-3 py-2.5"
                type="text"
                value="admin"
                disabled
                readOnly
              />
            </div>

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
                  placeholder="Enter auth key"
                  autoFocus
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

            <button type="button" className="self-end font-mono text-micro uppercase tracking-[0.18em] text-muted hover:text-primary">
              Reset_Key?
            </button>

            <button
              type="submit"
              disabled={busy}
              className="term-button-primary w-full !py-3 mt-2"
            >
              {busy ? (
                <>
                  <span className="font-mono">{'>'}</span>
                  <span>Authenticating</span>
                  <span className="cursor-blink">_</span>
                </>
              ) : (
                <>
                  <span className="font-mono">{'>'}</span>
                  <span>Enter_Core</span>
                </>
              )}
            </button>
          </form>

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
