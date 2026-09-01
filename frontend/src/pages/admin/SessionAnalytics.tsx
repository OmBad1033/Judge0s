import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api';
import type {
  SessionAnalytics,
  SlideAnalytics,
  FieldAnalytics,
  FieldStats,
  DefaultQuestionAnalytics,
} from '../../types';
import Skeleton from '../../components/Skeleton';
import { useToast } from '../../lib/toast';

// ============================================================================
// Post-session analytics dashboard.
//
// Per slide: title + summary + each configured question, with a purpose-built
// visual per field type:
//   boolean      -> donut + big "72% Yes" headline
//   single_select-> horizontal bars sorted by count
//   multi_select -> bar chart + co-occurrence ("people who picked A also B")
//   rating / nps -> distribution histogram + average (+ NPS score)
//   text/textarea-> word cloud + OpenRouter theme clustering + sentiment
// ============================================================================

const TYPE_COLORS: Record<string, string> = {
  boolean: 'text-primary border-primary bg-primary-dim',
  single_select: 'text-info border-info bg-[#eff6ff]',
  multi_select: 'text-warning border-warning bg-[#fef3c7]',
  rating: 'text-on-surface border-border bg-surface-1',
  nps: 'text-primary border-primary bg-primary-dim',
  text: 'text-danger border-danger bg-[#fef2f2]',
  textarea: 'text-danger border-danger bg-[#fef2f2]',
};

const TYPE_LABELS: Record<string, string> = {
  boolean: 'Yes / No',
  single_select: 'Single Select',
  multi_select: 'Multi Select',
  rating: 'Rating',
  nps: 'NPS',
  text: 'Free Text',
  textarea: 'Free Text',
};

const TYPE_ICONS: Record<string, string> = {
  boolean: 'toggle_on',
  single_select: 'radio_button_checked',
  multi_select: 'checklist',
  rating: 'star',
  nps: 'speed',
  text: 'chat',
  textarea: 'chat',
};

const SENTIMENT_STYLES: Record<string, { label: string; cls: string; icon: string }> = {
  positive: { label: 'Positive', cls: 'text-primary border-primary bg-primary-dim', icon: 'sentiment_satisfied' },
  negative: { label: 'Negative', cls: 'text-danger border-danger bg-[#fef2f2]', icon: 'sentiment_dissatisfied' },
  neutral: { label: 'Neutral', cls: 'text-muted border-border bg-surface-1', icon: 'sentiment_neutral' },
  mixed: { label: 'Mixed', cls: 'text-warning border-warning bg-[#fef3c7]', icon: 'sentiment_slightly_dissatisfied' },
};

// Per-slide accent palette — cycles so every slide card has a distinct identity.
const SLIDE_ACCENTS = [
  { solid: '#10b981', tint: '#ecfdf5' }, // emerald
  { solid: '#3b82f6', tint: '#eff6ff' }, // blue
  { solid: '#f59e0b', tint: '#fffbeb' }, // amber
  { solid: '#8b5cf6', tint: '#f5f3ff' }, // violet
  { solid: '#ec4899', tint: '#fdf2f8' }, // pink
  { solid: '#14b8a6', tint: '#f0fdfa' }, // teal
  { solid: '#f97316', tint: '#fff7ed' }, // orange
  { solid: '#6366f1', tint: '#eef2ff' }, // indigo
];

type StatsOf<K extends FieldStats['kind']> = Extract<FieldStats, { kind: K }>;

export default function SessionAnalytics() {
  const { code = '' } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ['analytics', code],
    queryFn: () => api.sessionAnalytics(code),
    enabled: !!code,
    staleTime: 30_000,
  });

  const aiMut = useMutation({
    mutationFn: () => api.runSessionAi(code),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['analytics', code], fresh);
      toast.push('success', 'AI analysis complete');
    },
    onError: (e) =>
      toast.push('error', e instanceof ApiError ? e.message : 'AI analysis failed'),
  });

  const data = q.data ?? null;

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="card" />
        <Skeleton variant="list" rows={4} />
      </div>
    );
  }

  if (q.isError || !data) {
    return (
      <div className="term-card border-danger bg-[#fef2f2] px-4 py-3 font-mono text-micro uppercase tracking-[0.15em] text-danger">
        {'>'} Analytics unavailable for this session.
      </div>
    );
  }

  const totalResponses = data.slides.reduce(
    (a, s) => a + s.fields.reduce((b, f) => b + f.responseCount, 0),
    0,
  );
  const ratingFields = data.slides.flatMap((s) => s.fields).filter((f) => f.stats.kind === 'rating');
  const avgRating =
    ratingFields.length > 0
      ? ratingFields.reduce((a, f) => a + (f.stats.kind === 'rating' ? f.stats.average : 0), 0) / ratingFields.length
      : null;
  const npsFields = data.slides.flatMap((s) => s.fields).filter((f) => f.stats.kind === 'nps');
  const avgNps =
    npsFields.length > 0
      ? npsFields.reduce((a, f) => a + (f.stats.kind === 'nps' ? f.stats.nps : 0), 0) / npsFields.length
      : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4 mb-2">
        <div>
          <div className="term-label">[Session_Analytics]</div>
          <h1 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-1">
            {data.session.presentation}
          </h1>
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
            Code: {data.session.code} &nbsp;·&nbsp; {data.session.status} &nbsp;·&nbsp; {data.session.slideCount} slides
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => aiMut.mutate()}
            disabled={aiMut.isPending || !data.hasAi || !data.aiConfigured}
            className="term-button-secondary min-h-[44px]"
            title={
              !data.aiConfigured
                ? 'Set OPENROUTER_API_KEY in worker/.dev.vars'
                : !data.hasAi
                  ? 'No free-text responses to analyze'
                  : 'Run theme clustering + sentiment on all free-text fields'
            }
          >
            <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
            {aiMut.isPending ? 'Analyzing...' : 'Run_AI_Analysis'}
          </button>
          <Link to={`/admin/sessions/${code}/results`} className="term-button-secondary min-h-[44px]">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Results
          </Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border">
        <Kpi label="Participants" value={String(data.session.participantCount)} icon="group" />
        <Kpi label="Responses" value={totalResponses.toLocaleString()} icon="rate_review" />
        <Kpi label="Avg Rating" value={avgRating !== null ? avgRating.toFixed(1) : '—'} icon="star" />
        <Kpi label="Avg NPS" value={avgNps !== null ? `${avgNps.toFixed(0)}` : '—'} icon="speed" />
      </div>

      {/* Per-slide sections */}
      {data.slides.map((slide) => (
        <SlideSection key={slide.slideNumber} slide={slide} busy={aiMut.isPending} />
      ))}

      {/* Default questions */}
      {data.defaultQuestions.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">stars</span>
            <h2 className="font-mono text-h1 uppercase tracking-[-0.01em] text-on-surface">
              Default_Questions
            </h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.defaultQuestions.map((dq) => (
              <DefaultQuestionCard key={dq.id} dq={dq} />
            ))}
          </div>
        </section>
      )}

      {!data.hasAi && (
        <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
          {'>'} No free-text responses collected — AI analysis not available.
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Building blocks
// ============================================================================

function Kpi({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-surface p-4">
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[16px] text-primary">{icon}</span>
        <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[{label}]</div>
      </div>
      <div className="font-mono text-display-sm mt-2 text-on-surface">{value}</div>
    </div>
  );
}

function SlideSection({ slide, busy }: { slide: SlideAnalytics; busy: boolean }) {
  const hasFields = slide.fields.length > 0;
  const accent = SLIDE_ACCENTS[(slide.slideNumber - 1) % SLIDE_ACCENTS.length];
  return (
    <section className="term-card relative overflow-hidden">
      {/* Colored accent band so adjacent slides read as distinct cards */}
      <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: accent.solid }} />
      {/* Slide header */}
      <div className="border-b border-border px-5 py-4 pl-6" style={{ backgroundColor: accent.tint }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="font-mono text-micro uppercase tracking-[0.15em] border px-2 py-1 text-white"
              style={{ backgroundColor: accent.solid, borderColor: accent.solid }}
            >
              Slide {String(slide.slideNumber).padStart(2, '0')}
            </span>
            {slide.title && (
              <h2 className="font-mono text-h1 uppercase tracking-[-0.01em] text-on-surface truncate">
                {slide.title}
              </h2>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              {slide.fields.reduce((a, f) => a + f.responseCount, 0)} responses
            </span>
          </div>
        </div>
        {slide.summary && (
          <p className="font-body text-body text-on-surface-variant mt-2 leading-relaxed max-w-3xl">
            {slide.summary}
          </p>
        )}
      </div>

      {/* Field visuals */}
      {!hasFields ? (
        <div className="px-5 py-6 text-center">
          <span className="material-symbols-outlined text-3xl text-muted">visibility_off</span>
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-2">
            {'>'} No feedback configured for this slide
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {slide.fields.map((f, i) => (
            <FieldRow key={f.fieldId} field={f} divider={i > 0} busy={busy} />
          ))}
        </div>
      )}
    </section>
  );
}

function FieldRow({ field, divider, busy }: { field: FieldAnalytics; divider: boolean; busy: boolean }) {
  const typeCls = TYPE_COLORS[field.fieldType] ?? 'text-muted border-border bg-surface-1';
  return (
    <div className={`px-5 py-5 ${divider ? 'border-t border-border' : ''}`}>
      {/* Question header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <span className={`inline-flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.15em] border px-2 py-1 ${typeCls}`}>
            <span className="material-symbols-outlined text-[14px]">
              {TYPE_ICONS[field.fieldType] ?? 'help'}
            </span>
            {TYPE_LABELS[field.fieldType] ?? field.fieldType}
          </span>
          <p className="font-mono text-body text-on-surface leading-snug mt-2">{field.label}</p>
        </div>
        <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted shrink-0">
          {field.responseCount}/{field.participantCount || '—'} responded
        </div>
      </div>

      <FieldVisual field={field} busy={busy} />
    </div>
  );
}

function FieldVisual({ field, busy }: { field: FieldAnalytics; busy: boolean }) {
  switch (field.stats.kind) {
    case 'boolean':
      return <BooleanVisual stats={field.stats} />;
    case 'single_select':
      return <BarVisual counts={field.stats.counts} />;
    case 'multi_select':
      return <MultiVisual stats={field.stats} options={field.options ?? []} />;
    case 'rating':
      return <RatingVisual stats={field.stats} />;
    case 'nps':
      return <NpsVisual stats={field.stats} />;
    case 'text':
      return <TextVisual stats={field.stats} busy={busy} />;
    default:
      return null;
  }
}

// --- Boolean: donut + headline ---
function BooleanVisual({ stats }: { stats: StatsOf<'boolean'> }) {
  const pct = stats.yesPct;
  const total = stats.yesCount + stats.noCount;
  return (
    <div className="flex flex-wrap items-center gap-8">
      <div className="relative w-36 h-36 shrink-0" aria-label={`${pct.toFixed(0)}% yes`}>
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(#10b981 0 ${pct}%, #ef4444 ${pct}% 100%)`,
          }}
        />
        <div className="absolute inset-3 bg-surface rounded-full flex flex-col items-center justify-center">
          <span className="font-mono text-display-sm text-primary">{pct.toFixed(0)}%</span>
          <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">Yes</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 font-mono text-body">
          <span className="w-3 h-3 bg-primary" />
          <span className="text-on-surface">Yes</span>
          <span className="text-muted">{stats.yesCount}</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-body">
          <span className="w-3 h-3 bg-danger" />
          <span className="text-on-surface">No</span>
          <span className="text-muted">{stats.noCount}</span>
        </div>
        <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
          {total} total
        </div>
      </div>
    </div>
  );
}

// --- Single-select / multi-select frequency: horizontal bars ---
function BarVisual({ counts }: { counts: Record<string, number> }) {
  const entries = useMemo(
    () =>
      Object.entries(counts)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
    [counts],
  );
  const total = entries.reduce((a, e) => a + e.value, 0) || 1;
  const max = entries.reduce((a, e) => Math.max(a, e.value), 0) || 1;

  if (entries.length === 0) return <EmptyNote />;

  return (
    <div className="flex flex-col gap-2.5 max-w-2xl">
      {entries.map((e) => (
        <div key={e.label} className="flex items-center gap-3">
          <span className="font-mono text-label text-on-surface min-w-[140px] truncate">{e.label}</span>
          <div className="flex-1 h-3 bg-surface-2 border border-border overflow-hidden">
            <div
              className="h-full bg-primary"
              style={{ width: `${(e.value / max) * 100}%` }}
              title={`${e.value} (${((e.value / total) * 100).toFixed(0)}%)`}
            />
          </div>
          <span className="font-mono text-label text-muted w-10 text-right">{e.value}</span>
          <span className="font-mono text-micro uppercase tracking-[0.15em] text-muted w-12 text-right">
            {((e.value / total) * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Multi-select: frequency + co-occurrence ---
function MultiVisual({
  stats,
  options,
}: {
  stats: StatsOf<'multi_select'>;
  options: string[];
}) {
  const picked = options.filter((o) => (stats.counts[o] ?? 0) > 0);
  const coPairs = useMemo(() => {
    const pairs: { a: string; b: string; n: number }[] = [];
    for (const a of picked) {
      const withB = stats.coOccurrence[a] ?? {};
      for (const [b, n] of Object.entries(withB)) {
        if (n > 0) pairs.push({ a, b, n });
      }
    }
    return pairs.sort((x, y) => y.n - x.n).slice(0, 8);
  }, [picked, stats.coOccurrence]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mb-2">Option frequency</div>
        <BarVisual counts={stats.counts} />
      </div>
      <div>
        <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mb-2">
          Co-occurrence — people who picked A also picked B
        </div>
        {coPairs.length === 0 ? (
          <EmptyNote />
        ) : (
          <div className="flex flex-col gap-1.5 max-w-2xl">
            {coPairs.map((p) => (
              <div key={`${p.a}-${p.b}`} className="flex items-center gap-2 font-mono text-label">
                <span className="border border-border bg-surface-1 px-2 py-0.5 text-on-surface truncate">
                  {p.a}
                </span>
                <span className="material-symbols-outlined text-[14px] text-muted">arrow_forward</span>
                <span className="border border-border bg-surface-1 px-2 py-0.5 text-on-surface truncate">
                  {p.b}
                </span>
                <span className="text-muted ml-auto shrink-0">{p.n}×</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Rating: distribution histogram ---
function RatingVisual({ stats }: { stats: StatsOf<'rating'> }) {
  return (
    <div className="max-w-xl">
      <div className="flex items-end gap-1 h-32">
        {Object.entries(stats.distribution)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([k, v]) => {
            const max = Math.max(...Object.values(stats.distribution), 1);
            return (
              <div key={k} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center" style={{ height: 'calc(100% - 18px)' }}>
                  <div
                    className="w-full max-w-[22px] bg-primary"
                    style={{ height: `${(v / max) * 100}%` }}
                    title={`${k}: ${v}`}
                  />
                </div>
                <span className="font-mono text-micro text-muted">{k}</span>
              </div>
            );
          })}
      </div>
      <div className="flex items-center gap-3 mt-3 font-mono text-label">
        <span className="material-symbols-outlined text-[16px] text-primary">star</span>
        <span className="text-on-surface">Average {stats.average.toFixed(1)}</span>
        <span className="text-muted">· {Object.values(stats.distribution).reduce((a, b) => a + b, 0)} responses</span>
      </div>
    </div>
  );
}

// --- NPS: gauge + promoters/detractors breakdown ---
function NpsVisual({ stats }: { stats: StatsOf<'nps'> }) {
  const clamped = Math.max(-100, Math.min(100, stats.nps));
  const color = clamped >= 50 ? '#10b981' : clamped >= 0 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex flex-wrap items-center gap-8">
      {/* Half-gauge via border */}
      <div className="w-44 h-24 relative overflow-hidden" aria-label={`NPS ${stats.nps.toFixed(0)}`}>
        <div
          className="w-44 h-44 rounded-full border-[14px]"
          style={{
            borderColor: color,
            transform: 'rotate(45deg)',
            clipPath: 'polygon(0 50%, 100% 50%, 100% 100%, 0 100%)',
          }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <span className="font-mono text-display-sm" style={{ color }}>
            {stats.nps > 0 ? '+' : ''}{stats.nps.toFixed(0)}
          </span>
          <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">NPS</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Legend color="#10b981" label="Promoters (9–10)" />
        <Legend color="#f59e0b" label="Passives (7–8)" />
        <Legend color="#ef4444" label="Detractors (0–6)" />
        <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
          {Object.values(stats.distribution).reduce((a, b) => a + b, 0)} responses
        </div>
      </div>
    </div>
  );
}

// --- Free text: word cloud + AI themes/sentiment ---
function TextVisual({
  stats,
  busy,
}: {
  stats: StatsOf<'text'>;
  busy: boolean;
}) {
  const words = useMemo(() => wordFrequency(stats.responses), [stats.responses]);
  const insight = stats.insight;
  const sentiment = insight ? SENTIMENT_STYLES[insight.sentiment] : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Word cloud */}
        <div>
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mb-2">
            Word cloud — {stats.responses.length} responses
          </div>
          {words.length === 0 ? (
            <EmptyNote />
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 border border-border bg-surface-1 p-4 items-baseline">
              {words.slice(0, 40).map((w) => (
                <span
                  key={w.word}
                  className="font-mono inline-block"
                  style={{
                    fontSize: `${Math.max(11, Math.min(30, 10 + w.count * 1.6))}px`,
                    color: wordColor(w.word, words.length),
                  }}
                  title={`${w.word}: ${w.count}`}
                >
                  {w.word}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* AI insight panel */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">AI insights</div>
            {!insight && (
              <span className="font-mono text-micro uppercase tracking-[0.15em] text-muted">
                Run via "Run_AI_Analysis" above
              </span>
            )}
          </div>
          {insight && sentiment ? (
            <div className="flex flex-col gap-3 border border-border bg-surface-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.15em] border px-2 py-1 ${sentiment.cls}`}>
                  <span className="material-symbols-outlined text-[14px]">{sentiment.icon}</span>
                  {sentiment.label}
                </span>
                <span className="font-mono text-label text-on-surface">
                  Score {insight.sentimentScore.toFixed(2)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {insight.themes.map((t) => (
                  <span
                    key={t.name}
                    className="font-mono text-micro uppercase tracking-[0.15em] border border-primary text-primary bg-primary-dim px-2 py-0.5"
                  >
                    {t.name} · {t.count}
                  </span>
                ))}
              </div>
              <p className="font-body text-body text-on-surface-variant leading-relaxed">{insight.summary}</p>
            </div>
          ) : (
            <div className="border border-border bg-surface-1 p-4 font-mono text-micro uppercase tracking-[0.18em] text-muted">
              {'>'} {busy ? 'Analyzing responses…' : 'No analysis yet. Click "Run_AI_Analysis" to generate themes + sentiment.'}
            </div>
          )}
        </div>
      </div>

      {/* Raw responses (collapsible) */}
      {stats.responses.length > 0 && (
        <details className="border border-border bg-surface-1">
          <summary className="px-4 py-2 font-mono text-micro uppercase tracking-[0.18em] text-muted cursor-pointer hover:text-on-surface">
            View {stats.responses.length} response{stats.responses.length === 1 ? '' : 's'}
          </summary>
          <div className="flex flex-col divide-y divide-border">
            {stats.responses.map((r, i) => (
              <p key={i} className="px-4 py-2.5 font-body text-body text-on-surface-variant">
                <span className="font-mono text-micro text-muted mr-2">{String(i + 1).padStart(2, '0')}</span>
                {r}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// --- Default questions ---
function DefaultQuestionCard({ dq }: { dq: DefaultQuestionAnalytics }) {
  return (
    <div className="term-card p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="font-mono text-micro uppercase tracking-[0.15em] border border-primary text-primary bg-primary-dim px-2 py-1">
          {dq.questionType === 'rating' ? 'Rating' : 'Interested?'}
        </span>
        <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
          {dq.responseCount}/{dq.participantCount || '—'} responded
        </span>
      </div>
      <p className="font-mono text-body text-on-surface mb-4 leading-snug">{dq.questionText}</p>
      {dq.questionType === 'rating' ? (
        <RatingVisual stats={dq.stats as StatsOf<'rating'>} />
      ) : (
        <InterestedVisual stats={dq.stats as InterestedStats} />
      )}
    </div>
  );
}

type InterestedStats = Extract<DefaultQuestionAnalytics['stats'], { kind: 'interested' }>;

function InterestedVisual({ stats }: { stats: InterestedStats }) {
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="flex items-center gap-6">
        <div>
          <span className="font-mono text-display-sm text-primary">{stats.interestedPct.toFixed(0)}%</span>
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">Interested</div>
        </div>
        <div className="flex flex-col gap-1">
          <Legend color="#10b981" label={`Interested (${stats.interestedCount})`} />
          <Legend color="#ef4444" label={`Not interested (${stats.notInterestedCount})`} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Small helpers
// ============================================================================

function EmptyNote() {
  return (
    <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted py-3">
      {'>'} No data yet
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-label">
      <span className="w-3 h-3" style={{ backgroundColor: color }} />
      <span className="text-on-surface">{label}</span>
    </div>
  );
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'we', 'they', 'he', 'she', 'them', 'their', 'my', 'your', 'our', 'as', 'so',
  'if', 'then', 'than', 'too', 'very', 'just', 'like', 'about', 'from', 'not', 'no', 'yes',
  'really', 'very', 'also', 'get', 'got', 'one', 'two', 'can', 'will', 'would', 'could',
  'should', 'have', 'has', 'had', 'do', 'does', 'did', 'there', 'here', 'what', 'when',
  'where', 'which', 'who', 'how', 'more', 'most', 'some', 'any', 'all', 'each', 'every',
]);

function wordFrequency(responses: string[]): { word: string; count: number }[] {
  const freq = new Map<string, number>();
  for (const r of responses) {
    const tokens = r
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .filter((w) => w.count >= 2)
    .slice(0, 60);
}

function wordColor(word: string, totalWords: number): string {
  const palette = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#0a0a0a', '#525252', '#14b8a6'];
  let h = 0;
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
