import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api';
import type { PresentationSummary } from '../../types';

function StatusPill({ status }: { status?: string }) {
  if (!status) {
    return <span className="status-pill status-pill-draft">[No_Session]</span>;
  }
  if (status === 'live') {
    return (
      <span className="status-pill status-pill-live">
        <span className="w-1.5 h-1.1 bg-primary rounded-full pulse-emerald inline-block" />
        Live
      </span>
    );
  }
  if (status === 'ended') {
    return <span className="status-pill status-pill-ended">Ended</span>;
  }
  return <span className="status-pill status-pill-draft">Draft</span>;
}

export default function UploadPresentation() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PresentationSummary[] | null>(null);
  const [err, setErr] = useState('');

  // upload modal state
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [slideCount, setSlideCount] = useState('5');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState('');

  const load = () => {
    api.listPresentations().then((r) => setItems(r.presentations)).catch(() => setItems([]));
  };
  useEffect(load, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setUploadErr('Select a .pptx file');
      return;
    }
    setBusy(true);
    setUploadErr('');
    try {
      const p = await api.createPresentation({ title, slideCount: Number(slideCount), file });
      navigate(`/admin/presentations/${p.id}/configure`);
    } catch (e) {
      setUploadErr(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const startSession = async (id: string) => {
    try {
      const s = await api.createSession(id);
      navigate(`/admin/sessions/${s.sessionCode}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to create session');
    }
  };

  return (
    <>
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4 mb-6">
        <div>
          <div className="term-label">[Library]</div>
          <h1 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-1">
            Presentation Library
          </h1>
          <p className="font-body text-body text-on-surface-variant mt-1">
            Upload, configure, and run live feedback sessions.
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="term-button-primary">
          <span className="material-symbols-outlined text-[18px]">add</span>
          Ingest_Presentation
        </button>
      </div>

      {err && (
        <div className="mb-4 term-card border-danger bg-[#fef2f2] px-4 py-3 font-mono text-micro uppercase tracking-[0.15em] text-danger">
          {'>'} {err}
        </div>
      )}

      {items === null ? (
        <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3 bg-border border border-border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-surface p-5 h-44 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 term-card">
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
            {'>'} No_Records_Found
          </div>
          <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-2">
            No presentations yet
          </h2>
          <p className="font-body text-body text-on-surface-variant mt-2 mb-6">
            Upload your first .pptx to begin a feedback session.
          </p>
          <button onClick={() => setOpen(true)} className="term-button-primary mx-auto">
            <span className="material-symbols-outlined text-[18px]">add</span>
            Ingest_Presentation
          </button>
        </div>
      ) : (
        <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3 bg-border border border-border">
          {items.map((p) => (
            <div key={p.id} className="bg-surface p-5 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-3">
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-primary">
                  [File]
                </span>
                <StatusPill status={p.latestSession?.status} />
              </div>
              <h3 className="font-mono text-h1 text-on-surface mb-1 truncate">{p.title}</h3>
              <p className="font-mono text-micro uppercase tracking-[0.15em] text-muted mb-4">
                {p.slideCount} Slides &nbsp;·&nbsp; {p.configuredSlides} Configured
              </p>
              <p className="font-mono text-micro uppercase tracking-[0.15em] text-muted mb-4 truncate">
                Src: {p.originalFilename}
              </p>
              <div className="mt-auto flex gap-px">
                <button
                  onClick={() => navigate(`/admin/presentations/${p.id}/configure`)}
                  className="flex-1 bg-surface border border-border hover:border-primary hover:text-primary font-mono text-label uppercase tracking-[0.15em] px-3 py-2 transition inline-flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">edit</span>
                  Configure
                </button>
                <button
                  onClick={() => startSession(p.id)}
                  className="flex-1 bg-surface border border-border hover:bg-primary hover:text-on-primary hover:border-primary font-mono text-label uppercase tracking-[0.15em] px-3 py-2 transition inline-flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                  Start
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-surface/30 backdrop-blur-sm"
          onClick={() => !busy && setOpen(false)}
        >
          <div className="term-card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-border px-5 py-4">
              <div>
                <div className="term-label">[Ingest_Presentation]</div>
                <h2 className="font-mono text-h1 text-on-surface mt-1">Upload Presentation</h2>
              </div>
              <button
                onClick={() => !busy && setOpen(false)}
                className="text-muted hover:text-on-surface"
                disabled={busy}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <form className="px-5 py-5 flex flex-col gap-4" onSubmit={submit}>
              <div>
                <label className="term-label block mb-1.5">Title</label>
                <input
                  className="term-input px-3 py-2.5"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="e.g. Q3 Strategy Review"
                />
              </div>
              <div>
                <label className="term-label block mb-1.5">Slide_Count</label>
                <input
                  type="number"
                  min="1"
                  className="term-input px-3 py-2.5"
                  value={slideCount}
                  onChange={(e) => setSlideCount(e.target.value)}
                  required
                />
              </div>
              <label className="border border-dashed border-border hover:border-primary hover:bg-surface-1 transition py-8 text-center cursor-pointer">
                <span className="material-symbols-outlined text-3xl text-muted">cloud_upload</span>
                {file ? (
                  <span className="block font-mono text-micro uppercase tracking-[0.15em] text-primary mt-2">
                    {'>'} {file.name}
                  </span>
                ) : (
                  <span className="block font-mono text-micro uppercase tracking-[0.15em] text-muted mt-2">
                    {'>'} Drop .pptx here or click to browse
                  </span>
                )}
                <input
                  type="file"
                  accept=".pptx"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                  disabled={busy}
                />
              </label>
              {uploadErr && (
                <div className="font-mono text-micro uppercase tracking-[0.15em] text-danger">
                  {'>'} {uploadErr}
                </div>
              )}
              <button
                type="submit"
                className="term-button-primary w-full !py-3 mt-2"
                disabled={busy}
              >
                {busy ? (
                  <>
                    <span>{'>'}</span>
                    Uploading
                    <span className="cursor-blink">_</span>
                  </>
                ) : (
                  <>
                    <span>{'>'}</span>
                    Upload &amp; Configure
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
