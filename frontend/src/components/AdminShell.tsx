import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { api } from '../api';

// Desktop-first admin shell — sticky left sidebar with the brand, primary
// nav, and logout; content area on the right. On mobile the sidebar collapses
// into a top bar with a single "Library" link.
export default function AdminShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
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

  const logout = async () => {
    await api.adminLogout().catch(() => {});
    navigate('/admin/login');
  };

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

  return (
    <div className="min-h-screen bg-background text-on-surface font-body flex flex-col">
      <header className="sticky top-0 z-50 bg-surface border-b border-border lg:hidden">
        <div className="h-14 px-4 flex items-center justify-between gap-3">
          <NavLink to="/admin/presentations" className="font-mono text-label uppercase tracking-[0.15em]">
            Judge_OS<span className="text-muted">:v1.0</span>
          </NavLink>
          <div className="flex items-center gap-2">
            <NavLink
              to="/admin/presentations"
              className="font-mono text-micro uppercase tracking-[0.15em] text-muted hover:text-on-surface"
            >
              Library
            </NavLink>
            <button
              onClick={logout}
              className="w-9 h-9 inline-flex items-center justify-center text-muted hover:text-on-surface"
              aria-label="Logout"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
            </button>
          </div>
        </div>
        <div className="h-px scan-sweep" />
      </header>

      <div className="flex-1 flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-60 shrink-0 border-r border-border bg-surface flex-col">
          <NavLink
            to="/admin/presentations"
            className="h-14 flex items-center px-5 border-b border-border font-mono text-label uppercase tracking-[0.15em] hover:text-primary transition"
          >
            Judge_OS<span className="text-muted">:v1.0</span>
          </NavLink>
          <nav className="flex-1 p-3 flex flex-col gap-1">
            <SidebarLink to="/admin/presentations" icon="library_books" label="Library" exact />
            <SidebarLink to="/admin/presentations" icon="add_circle" label="New Presentation" />
          </nav>
          <div className="p-3 border-t border-border flex flex-col gap-1">
            <button
              onClick={logout}
              className="flex items-center gap-2 px-3 py-2 font-mono text-label uppercase tracking-[0.15em] text-muted hover:text-on-surface hover:bg-surface-1 transition"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
              <span>Logout</span>
            </button>
          </div>
          <div className="px-3 py-2 border-t border-border font-mono text-micro uppercase tracking-[0.18em] text-muted">
            Sync.Time {new Date().toISOString().slice(11, 19)}Z
          </div>
        </aside>

        <main className="flex-1 min-w-0 px-4 md:px-6 py-6 max-w-[1280px] w-full mx-auto">{children}</main>
      </div>

      <footer className="border-t border-border bg-surface">
        <div className="max-w-[1280px] mx-auto px-4 md:px-6 h-8 flex items-center justify-between font-mono text-micro uppercase tracking-[0.18em] text-muted">
          <span>Judge_OS — Internal Feedback System</span>
          <span className="hidden md:inline">Sys.Health: Optimal &nbsp;·&nbsp; Latency: 12ms</span>
        </div>
      </footer>
    </div>
  );
}

function SidebarLink({
  to,
  icon,
  label,
  exact,
}: {
  to: string;
  icon: string;
  label: string;
  exact?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2 font-mono text-label uppercase tracking-[0.15em] transition ${
          isActive
            ? 'bg-primary-dim text-primary border-l-2 border-primary'
            : 'text-muted hover:text-on-surface hover:bg-surface-1 border-l-2 border-transparent'
        }`
      }
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}