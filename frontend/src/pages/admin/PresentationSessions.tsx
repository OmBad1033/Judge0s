import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api';
import type { Presentation, Session } from '../../types';
import { useToast } from '../../lib/toast';
import Skeleton from '../../components/Skeleton';

// Sessions-for-one-presentation view.
// Reached by clicking a card on /admin/presentations.
//
// • Top bar: presentation title + Configure (slides) + Start (create+go-live) actions.
// • Table: every session ever created for this presentation. Rows deep-link
//   into the live ControlSession view (ended sessions route to Results).
export default function PresentationSessions() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [sessionName, setSessionName] = useState('');

  const presQ = useQuery({
    queryKey: ['presentation', id],
    queryFn: () => api.getPresentation(id),
    enabled: !!id,
  });

  const sessionsQ = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => api.listSessions(id).then((r) => r.sessions),
    enabled: !!id,
    refetchInterval: 15_000,
  });

  const startMut = useMutation({
    mutationFn: () => api.createSession(id, sessionName.trim() || undefined),
    onSuccess: (s) => {
      toast.push('success', 'Session started');
      queryClient.invalidateQueries({ queryKey: ['sessions', id] });
      queryClient.invalidateQueries({ queryKey: ['presentations'] });
      setShowNamePrompt(false);
      setSessionName('');
      navigate(`/admin/sessions/${s.sessionCode}`);
    },
    onError: (e) =>
      toast.push('error', e instanceof ApiError ? e.message : 'Failed to start session'),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.deletePresentation(id),
    onSuccess: () => {
      toast.push('success', 'Presentation and all its data deleted');
      queryClient.invalidateQueries({ queryKey: ['presentations'] });
      navigate('/admin/presentations');
    },
    onError: (e) => {
      toast.push('error', e instanceof ApiError ? e.message : 'Failed to delete presentation');
      setConfirmDelete(false);
    },
  });

  if (presQ.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="card" />
        <Skeleton variant="list" rows={3} />
      </div>
    );
  }

  if (presQ.isError || !presQ.data) {
    return (
      <div className="term-card border-danger bg-[#fef2f2] px-4 py-3 font-mono text-micro uppercase tracking-[0.15em] text-danger">
        {'>'} Presentation not found
      </div>
    );
  }

  const presentation = presQ.data;
  const sessions = sessionsQ.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-[0.18em] text-muted">
        <Link to="/admin/presentations" className="hover:text-on-surface">
          Library
        </Link>
        <span>/</span>
        <span className="text-on-surface truncate">{presentation.title}</span>
      </div>

      {/* HEADER + actions */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0 flex-1">
          <div className="term-label">[Presentation]</div>
          <h1 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-1 truncate">
            {presentation.title}
          </h1>
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
            {presentation.slideCount} Slides &nbsp;·&nbsp; {sessions.length} Session
            {sessions.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleteMut.isPending}
            className="term-button-secondary min-h-[44px] !text-danger !border-danger hover:!bg-danger hover:!text-white"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
            Delete
          </button>
          <Link
            to={`/admin/presentations/${presentation.id}/configure`}
            className="term-button-secondary min-h-[44px]"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
            Configure
          </Link>
          <button
            onClick={() => setShowNamePrompt(true)}
            disabled={startMut.isPending}
            className="term-button-primary min-h-[44px]"
          >
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
            Start_Session
          </button>
        </div>
      </div>

      {/* TABLE */}
      {sessionsQ.isLoading ? (
        <Skeleton variant="list" rows={3} />
      ) : sessions.length === 0 ? (
        <EmptySessions onStart={() => setShowNamePrompt(true)} busy={startMut.isPending} />
      ) : (
        <SessionsTable sessions={sessions} presentation={presentation} />
      )}

      {showNamePrompt && (
        <SessionNamePrompt
          busy={startMut.isPending}
          value={sessionName}
          onChange={setSessionName}
          onCancel={() => {
            if (!startMut.isPending) {
              setShowNamePrompt(false);
              setSessionName('');
            }
          }}
          onConfirm={() => startMut.mutate()}
        />
      )}

      {confirmDelete && (
        <DeleteConfirmModal
          presentationTitle={presentation.title}
          sessionCount={sessions.length}
          busy={deleteMut.isPending}
          onCancel={() => !deleteMut.isPending && setConfirmDelete(false)}
          onConfirm={() => deleteMut.mutate()}
        />
      )}
    </div>
  );
}

function DeleteConfirmModal({
  presentationTitle,
  sessionCount,
  busy,
  onCancel,
  onConfirm,
}: {
  presentationTitle: string;
  sessionCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-surface/30 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
    >
      <div className="term-card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-5 py-4">
          <div className="term-label text-danger">[Danger_Zone]</div>
          <h2 id="delete-title" className="font-mono text-h1 text-on-surface mt-1">
            Delete Presentation?
          </h2>
        </div>
        <div className="px-5 py-5">
          <p className="font-body text-body text-on-surface-variant">
            This permanently removes{' '}
            <span className="font-mono text-on-surface">{presentationTitle}</span> and{' '}
            <span className="font-mono text-on-surface">
              all {sessionCount} session{sessionCount === 1 ? '' : 's'}
            </span>{' '}
            associated with it, including every participant response and the uploaded file.
          </p>
          <p className="font-mono text-micro uppercase tracking-[0.15em] text-danger mt-3">
            {'>'} This action cannot be undone.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button onClick={onCancel} disabled={busy} className="term-button-secondary min-h-[44px]">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy} className="term-button-primary min-h-[44px] !bg-danger">
            {busy ? 'Deleting...' : 'Delete_Everything'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionNamePrompt({
  value,
  onChange,
  busy,
  onCancel,
  onConfirm,
}: {
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-surface/30 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-name-title"
    >
      <div className="term-card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-5 py-4">
          <div className="term-label">[New_Session]</div>
          <h2 id="session-name-title" className="font-mono text-h1 text-on-surface mt-1">
            Name this session?
          </h2>
        </div>
        <form
          className="px-5 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <label className="term-label block mb-1.5" htmlFor="session-name-input">
            Session_Name
          </label>
          <input
            id="session-name-input"
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={120}
            placeholder="e.g. Q3 Board Review"
            className="w-full h-11 px-3 border border-border bg-surface font-mono text-body text-on-surface placeholder:text-muted focus:border-primary focus:outline-none"
          />
          <p className="font-mono text-micro uppercase tracking-[0.15em] text-muted mt-3">
            {'>'} You can leave this blank — we&apos;ll use the session code.
          </p>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-4 -mx-5 -mb-5 mt-5">
            <button type="button" onClick={onCancel} disabled={busy} className="term-button-secondary min-h-[44px]">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="term-button-primary min-h-[44px]">
              {busy ? 'Starting...' : 'Start_Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Session['status'] }) {
  if (status === 'live') {
    return (
      <span className="status-pill status-pill-live">
        <span className="w-1.5 h-1.5 bg-primary rounded-full pulse-emerald inline-block" />
        Live
      </span>
    );
  }
  if (status === 'ended') return <span className="status-pill status-pill-ended">Ended</span>;
  if (status === 'paused') return <span className="status-pill status-pill-draft">Paused</span>;
  return <span className="status-pill status-pill-draft">Draft</span>;
}

function SessionsTable({ sessions, presentation }: { sessions: Session[]; presentation: Presentation }) {
  return (
    <div className="term-card overflow-x-auto">
      <table className="w-full font-mono text-label">
        <thead>
          <tr className="border-b border-border text-micro uppercase tracking-[0.18em] text-muted">
            <th className="text-left px-4 py-3 font-normal">[Name]</th>
            <th className="text-left px-4 py-3 font-normal">[Code]</th>
            <th className="text-left px-4 py-3 font-normal">Status</th>
            <th className="text-left px-4 py-3 font-normal hidden sm:table-cell">Slide</th>
            <th className="text-left px-4 py-3 font-normal hidden md:table-cell">Created</th>
            <th className="text-left px-4 py-3 font-normal hidden md:table-cell">Started</th>
            <th className="text-left px-4 py-3 font-normal hidden lg:table-cell">Ended</th>
            <th className="text-right px-4 py-3 font-normal">Open</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const target =
              s.status === 'ended'
                ? `/admin/sessions/${s.sessionCode}/results`
                : `/admin/sessions/${s.sessionCode}`;
            const slideLabel =
              s.status === 'ended' || s.status === 'draft'
                ? '—'
                : `${s.currentSlideNumber ?? 0} / ${presentation.slideCount}`;
            return (
              <tr
                key={s.id}
                onClick={() => {
                  window.location.href = target;
                }}
                className="border-b border-border last:border-b-0 hover:bg-surface-1 cursor-pointer transition"
              >
                <td className="px-4 py-3 text-on-surface">{s.name || s.sessionCode}</td>
                <td className="px-4 py-3 text-muted">{s.sessionCode}</td>
                <td className="px-4 py-3">
                  <StatusPill status={s.status} />
                </td>
                <td className="px-4 py-3 text-muted hidden sm:table-cell">{slideLabel}</td>
                <td className="px-4 py-3 text-muted hidden md:table-cell">
                  {formatTime(s.createdAt)}
                </td>
                <td className="px-4 py-3 text-muted hidden md:table-cell">
                  {s.startedAt ? formatTime(s.startedAt) : '—'}
                </td>
                <td className="px-4 py-3 text-muted hidden lg:table-cell">
                  {s.endedAt ? formatTime(s.endedAt) : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="material-symbols-outlined text-[18px] text-muted">chevron_right</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptySessions({ onStart, busy }: { onStart: () => void; busy: boolean }) {
  return (
    <div className="term-card text-center px-5 py-12">
      <span className="material-symbols-outlined text-4xl text-muted">cast</span>
      <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-3">
        No_Sessions_Yet
      </h2>
      <p className="font-body text-body text-on-surface-variant mt-1 mb-6">
        Start your first session to invite participants.
      </p>
      <button onClick={onStart} disabled={busy} className="term-button-primary mx-auto min-h-[48px]">
        <span className="material-symbols-outlined text-[18px]">play_arrow</span>
        {busy ? 'Starting...' : 'Start_Session'}
      </button>
    </div>
  );
}

function formatTime(iso: string): string {
  // Trim to YYYY-MM-DD HH:MM in UTC for a compact, locale-stable display.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}