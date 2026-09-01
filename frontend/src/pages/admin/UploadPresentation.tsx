import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api';
import type { PresentationSummary } from '../../types';
import { useToast } from '../../lib/toast';
import Skeleton from '../../components/Skeleton';

function StatusPill({ status }: { status?: string }) {
  if (!status) return <span className="status-pill status-pill-draft">[No_Session]</span>;
  if (status === 'live') {
    return (
      <span className="status-pill status-pill-live">
        <span className="w-1.5 h-1.5 bg-primary rounded-full pulse-emerald inline-block" />
        Live
      </span>
    );
  }
  if (status === 'ended') return <span className="status-pill status-pill-ended">Ended</span>;
  return <span className="status-pill status-pill-draft">Draft</span>;
}

export default function UploadPresentation() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [slideCount, setSlideCount] = useState('5');
  const [file, setFile] = useState<File | null>(null);
  const [uploadErr, setUploadErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const isPdf = file ? /\.pdf$/i.test(file.name) : false;

  const listQ = useQuery({
    queryKey: ['presentations'],
    queryFn: () => api.listPresentations().then((r) => r.presentations),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.createPresentation({
        title,
        ...(isPdf ? {} : { slideCount: Number(slideCount) }),
        file: file!,
      }),
    onSuccess: (p) => {
      toast.push('success', 'Presentation uploaded');
      queryClient.invalidateQueries({ queryKey: ['presentations'] });
      setOpen(false);
      setTitle('');
      setSlideCount('5');
      setFile(null);
      navigate(`/admin/presentations/${p.id}/configure`);
    },
    onError: (e) => setUploadErr(e instanceof ApiError ? e.message : 'Upload failed'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setUploadErr('Select a .pptx or .pdf file');
      return;
    }
    setUploadErr('');
    createMut.mutate();
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4 mb-4">
        <div>
          <div className="term-label">[Library]</div>
          <h1 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-1">
            Presentation Library
          </h1>
          <p className="font-body text-body text-on-surface-variant mt-1">
            Upload, configure, and run live feedback sessions. PDFs are auto-extracted.
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="term-button-primary min-h-[44px]">
          <span className="material-symbols-outlined text-[18px]">add</span>
          Event
        </button>
      </div>

      {listQ.isLoading ? (
        <Skeleton variant="list" rows={3} />
      ) : listQ.isError ? (
        <div className="term-card border-danger bg-[#fef2f2] px-4 py-3 font-mono text-micro uppercase tracking-[0.15em] text-danger">
          {'>'} Failed to load presentations
        </div>
      ) : (listQ.data ?? []).length === 0 ? (
        <EmptyState onCreate={() => setOpen(true)} />
      ) : (
        <PresentationGrid items={listQ.data!} />
      )}

      {open && (
        <UploadModal
          title={title}
          slideCount={slideCount}
          file={file}
          isPdf={isPdf}
          busy={createMut.isPending}
          err={uploadErr}
          fileRef={fileRef}
          onTitle={setTitle}
          onSlideCount={setSlideCount}
          onFile={setFile}
          onClose={() => {
            if (createMut.isPending) return;
            setOpen(false);
            setUploadErr('');
          }}
          onSubmit={submit}
        />
      )}
    </>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-16 term-card">
      <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
        {'>'} No_Records_Found
      </div>
      <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-2">
        No presentations yet
      </h2>
      <p className="font-body text-body text-on-surface-variant mt-2 mb-6">
        Upload your first .pptx or .pdf to begin a feedback session.
      </p>
      <button onClick={onCreate} className="term-button-primary mx-auto min-h-[44px]">
        <span className="material-symbols-outlined text-[18px]">add</span>
          Event
      </button>
    </div>
  );
}

function PresentationGrid({ items }: { items: PresentationSummary[] }) {
  const navigate = useNavigate();
  return (
    <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3 bg-border border border-border">
      {items.map((p) => (
        <button
          key={p.id}
          onClick={() => navigate(`/admin/presentations/${p.id}/sessions`)}
          className="bg-surface p-5 flex flex-col text-left hover:bg-surface-1 transition min-h-[160px] group"
        >
          <div className="flex items-start justify-between gap-2 mb-3">
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-primary">[File]</span>
            <StatusPill status={p.latestSession?.status} />
          </div>
          <h3 className="font-mono text-h1 text-on-surface mb-1 truncate group-hover:text-primary transition">
            {p.title}
          </h3>
          <p className="font-mono text-micro uppercase tracking-[0.15em] text-muted mb-4">
            {p.slideCount} Slides &nbsp;·&nbsp; {p.configuredSlides} Configured
          </p>
          <p className="font-mono text-micro uppercase tracking-[0.15em] text-muted mb-4 truncate">
            Src: {p.originalFilename}
          </p>
          {p.latestSession && (
            <p className="font-mono text-micro uppercase tracking-[0.15em] text-muted mb-4 truncate">
              Latest: {p.latestSession.sessionCode}
            </p>
          )}
          <div className="mt-auto flex items-center justify-between font-mono text-micro uppercase tracking-[0.18em] text-muted group-hover:text-primary transition">
            <span>View_Sessions</span>
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function UploadModal({
  title,
  slideCount,
  file,
  isPdf,
  busy,
  err,
  fileRef,
  onTitle,
  onSlideCount,
  onFile,
  onClose,
  onSubmit,
}: {
  title: string;
  slideCount: string;
  file: File | null;
  isPdf: boolean;
  busy: boolean;
  err: string;
  fileRef: React.RefObject<HTMLInputElement>;
  onTitle: (v: string) => void;
  onSlideCount: (v: string) => void;
  onFile: (f: File | null) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const showSlideCount = file !== null && !isPdf;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-surface/30 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-title"
    >
      <div className="term-card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center border-b border-border px-5 py-4">
          <div>
            <div className="term-label">[Event]</div>
            <h2 id="upload-title" className="font-mono text-h1 text-on-surface mt-1">
              Upload Presentation
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-on-surface min-w-[44px] min-h-[44px]"
            disabled={busy}
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <form className="px-5 py-5 flex flex-col gap-4" onSubmit={onSubmit}>
          <div>
            <label className="term-label block mb-1.5" htmlFor="upload-title-input">
              Title
            </label>
            <input
              id="upload-title-input"
              className="term-input px-3 py-2.5 min-h-[44px]"
              value={title}
              onChange={(e) => onTitle(e.target.value)}
              required
              placeholder="e.g. Q3 Strategy Review"
            />
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="border border-dashed border-border hover:border-primary hover:bg-surface-1 transition py-8 text-center cursor-pointer min-h-[120px]"
          >
            <span className="material-symbols-outlined text-3xl text-muted">cloud_upload</span>
            {file ? (
              <span className="block font-mono text-micro uppercase tracking-[0.15em] text-primary mt-2">
                {'>'} {file.name}
              </span>
            ) : (
              <span className="block font-mono text-micro uppercase tracking-[0.15em] text-muted mt-2">
                {'>'} Drop .pptx or .pdf here or click to browse
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".pptx,.pdf"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              required
              disabled={busy}
            />
          </button>
          {showSlideCount && (
            <div>
              <label className="term-label block mb-1.5" htmlFor="upload-slide-count">
                Slide_Count
              </label>
              <input
                id="upload-slide-count"
                type="number"
                min="1"
                className="term-input px-3 py-2.5 min-h-[44px]"
                value={slideCount}
                onChange={(e) => onSlideCount(e.target.value)}
                required
              />
            </div>
          )}
          {err && (
            <div className="font-mono text-micro uppercase tracking-[0.15em] text-danger">
              {'>'} {err}
            </div>
          )}
          <button
            type="submit"
            className="term-button-primary w-full !py-3 mt-2 min-h-[48px]"
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
  );
}