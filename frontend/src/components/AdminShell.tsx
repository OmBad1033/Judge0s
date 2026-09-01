import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { api } from '../api';

// Admin shell with a top dock (SaaS-style): brand + signed-in user's name on
// the left, primary nav (Library, New Presentation) in the middle, logout on
// the right. Content renders below the bar.
export default function AdminShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'ok' | 'unauth'>('loading');
  const [userName, setUserName] = useState<string | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminMe()
      .then((res) => {
        setUserName(res.user?.name ?? null);
        setUserAvatar(res.user?.avatarUrl ?? null);
        setState('ok');
      })
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
      <header className="sticky top-0 z-50 bg-surface border-b border-border">
        <div className="h-14 px-4 md:px-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {/* Brand (top-left) */}
          <NavLink
            to="/admin/presentations"
            className="justify-self-start font-mono text-label uppercase tracking-[0.15em] shrink-0 hover:text-primary transition"
          >
            Judge_OS<span className="text-muted">:v1.0</span>
          </NavLink>

          {/* Primary nav (center) */}
          <nav className="flex items-center gap-1 md:gap-2 justify-self-center">
            <TopBarLink to="/admin/presentations" icon="library_books" label="Library" exact />
            <TopBarLink to="/admin/presentations" icon="add_circle" label="New Presentation" />
            <span
              aria-disabled="true"
              title="Coming soon"
              className="group flex items-center gap-2 px-3 py-2 rounded font-mono text-label uppercase tracking-[0.15em] text-muted/40 select-none cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[18px] transition-transform duration-300 group-hover:rotate-12">
                gavel
              </span>
              <span>Judge</span>
            </span>
          </nav>

          {/* User identity + logout (top-right) */}
          <div className="flex items-center gap-3 justify-self-end shrink-0">
            <span className="hidden sm:flex items-center gap-2 min-w-0 text-muted">
              {userAvatar ? (
                <img
                  src={userAvatar}
                  alt=""
                  className="w-6 h-6 rounded-full shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="w-6 h-6 rounded-full bg-primary-dim text-primary flex items-center justify-center font-mono text-micro uppercase shrink-0">
                  {(userName ?? 'A').slice(0, 1)}
                </span>
              )}
              <span className="truncate font-mono text-label uppercase tracking-[0.15em]">
                {userName ?? 'Admin'}
              </span>
            </span>
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

      <main className="flex-1 min-w-0 px-4 md:px-6 py-6 max-w-[1280px] w-full mx-auto">{children}</main>

      <footer className="border-t border-border bg-surface">
        <div className="max-w-[1280px] mx-auto px-4 md:px-6 h-8 flex items-center justify-between font-mono text-micro uppercase tracking-[0.18em] text-muted">
          <span>Judge_OS — Internal Feedback System</span>
          <span className="hidden md:inline">Sys.Health: Optimal &nbsp;·&nbsp; Latency: 12ms</span>
        </div>
      </footer>
    </div>
  );
}

function TopBarLink({
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
        `group relative flex items-center gap-2 px-3 py-2 font-mono text-label uppercase tracking-[0.15em] transition ${
          isActive
            ? 'text-primary'
            : 'text-muted hover:text-on-surface'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`material-symbols-outlined text-[18px] transition-all duration-300 ${
              isActive
                ? 'fill scale-110 -translate-x-0.5'
                : 'group-hover:-translate-x-0.5 group-hover:scale-110'
            }`}
          >
            {icon}
          </span>
          <span className="relative">
            {label}
            <span
              aria-hidden="true"
              className={`absolute -bottom-1 left-0 h-px bg-primary transition-all duration-300 ease-out ${
                isActive
                  ? 'w-full opacity-100'
                  : 'w-0 opacity-0 group-hover:w-full group-hover:opacity-60'
              }`}
            />
          </span>
        </>
      )}
    </NavLink>
  );
}
