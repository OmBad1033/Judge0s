import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, NavLink, useLocation } from 'react-router-dom';
import { api } from '../api';

// Judge OS admin shell: auth guard + top terminal nav (HOME / PRESENTATION /
// RESULTS / REPORTS tabs, brand mark left, settings + CREATE_EVENT right).
export default function AdminShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<'loading' | 'ok' | 'unauth'>('loading');

  useEffect(() => {
    api
      .adminMe()
      .then(() => setState('ok'))
      .catch(() => setState('unauth'));
  }, []);

  useEffect(() => {
    if (state === 'unauth') navigate('/admin/login', { replace: true });
  }, [state, navigate]);

  if (state !== 'ok') {
    return (
      <div className="min-h-screen flex items-center justify-center dot-grid text-on-surface font-mono">
        <div className="flex items-center gap-2 text-label uppercase tracking-[0.15em]">
          <span className="text-primary">{'>'}</span>
          <span>Authenticating</span>
          <span className="cursor-blink">_</span>
        </div>
      </div>
    );
  }

  // The Stitch top nav has 4 tabs. We map each to a real route where one
  // exists. REPORTS has no dedicated page yet, so it's disabled.
  const navItems: { to: string; label: string; exact?: boolean; disabled?: boolean }[] = [
    { to: '/admin/presentations', label: 'Home', exact: true },
    { to: '/admin/presentations', label: 'Presentation' },
    { to: '/admin/presentations', label: 'Results' },
    { to: '/admin/presentations', label: 'Reports', disabled: true },
  ];

  const isOnHome = location.pathname === '/admin/presentations';

  return (
    <div className="min-h-screen bg-background text-on-surface font-body">
      {/* Top terminal nav */}
      <header className="sticky top-0 z-50 bg-surface border-b border-border">
        <div className="max-w-[1280px] mx-auto h-14 px-4 md:px-6 flex items-center justify-between gap-6">
          <NavLink to="/admin/presentations" className="flex items-center gap-3 group shrink-0">
            <span className="font-mono text-label uppercase tracking-[0.15em] text-on-surface group-hover:text-primary transition">
              Judge_OS<span className="text-muted">:v1.0</span>
            </span>
          </NavLink>

          <nav className="hidden md:flex items-center gap-6 flex-1 justify-center">
            {navItems.map((item, i) => {
              if (item.disabled) {
                return (
                  <span
                    key={item.label + i}
                    className="font-mono text-label uppercase tracking-[0.18em] text-muted/50 cursor-not-allowed"
                  >
                    {item.label}
                  </span>
                );
              }
              const active = isOnHome && i === 0;
              return (
                <NavLink
                  key={item.label + i}
                  to={item.to}
                  end={item.exact}
                  className={`font-mono text-label uppercase tracking-[0.18em] pb-1 border-b-2 transition ${
                    active
                      ? 'text-on-surface border-primary'
                      : 'text-muted hover:text-on-surface border-transparent'
                  }`}
                >
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              className="hidden md:inline-flex w-8 h-8 items-center justify-center text-muted hover:text-on-surface transition"
              title="Settings"
            >
              <span className="material-symbols-outlined text-[18px]">settings</span>
            </button>
            <button
              className="hidden md:inline-flex w-8 h-8 items-center justify-center text-muted hover:text-on-surface transition"
              title="Help"
            >
              <span className="material-symbols-outlined text-[18px]">help</span>
            </button>
            <NavLink
              to="/admin/presentations"
              className="term-button-primary !px-3 !py-1.5 !text-[0.6875rem]"
            >
              <span>+ Create_Event</span>
            </NavLink>
            <button
              onClick={async () => {
                await api.adminLogout();
                navigate('/admin/login');
              }}
              className="hidden md:inline-flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.15em] text-muted hover:text-on-surface px-2 py-1 transition"
              title="Logout"
            >
              <span className="material-symbols-outlined text-[16px]">logout</span>
              <span>Logout</span>
            </button>
            <button
              onClick={async () => {
                await api.adminLogout();
                navigate('/admin/login');
              }}
              className="md:hidden w-8 h-8 inline-flex items-center justify-center text-muted hover:text-on-surface"
              title="Logout"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
            </button>
          </div>
        </div>
        <div className="h-px scan-sweep" />
      </header>

      <main className="max-w-[1280px] mx-auto px-4 md:px-6 py-6">{children}</main>

      <footer className="border-t border-border bg-surface">
        <div className="max-w-[1280px] mx-auto px-4 md:px-6 h-8 flex items-center justify-between font-mono text-micro uppercase tracking-[0.18em] text-muted">
          <span>Judge_OS — Internal Feedback System</span>
          <span className="hidden md:inline">
            Sys.Health: Optimal &nbsp;·&nbsp; Latency: 12ms &nbsp;·&nbsp; Sync.Time: {new Date().toISOString().slice(11, 19)}Z
          </span>
        </div>
      </footer>
    </div>
  );
}
