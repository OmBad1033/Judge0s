import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api';
import type { ExportData } from '../../types';
import {
  totalEvaluations,
  totalNodesProcessed,
  payloadScore,
  aiCompliance,
} from '../../lib/metrics';

function toCSV(data: ExportData): string {
  const headers = ['Slide', 'Name', 'Email', 'Question', 'Type', 'Response', 'Submitted'];
  const rows = data.feedback.map((f) => [
    String(f.slideNumber),
    JSON.stringify(f.user.name),
    JSON.stringify(f.user.email),
    JSON.stringify(f.question ?? ''),
    f.feedbackType,
    JSON.stringify(f.response ?? ''),
    f.submittedAt,
  ]);
  const dHeaders = ['Slide', 'Name', 'Email', 'Question', 'Type', 'Response', 'Submitted'];
  const dRows = data.defaultFeedback.map((f) => [
    String(f.slideNumber),
    JSON.stringify(f.user.name),
    JSON.stringify(f.user.email),
    JSON.stringify(f.question),
    f.questionType,
    JSON.stringify(f.response ?? ''),
    f.submittedAt,
  ]);
  return [headers, ...rows, dHeaders, ...dRows].map((r) => r.join(',')).join('\n');
}

export default function SessionResults() {
  const { code } = useParams();
  const [data, setData] = useState<ExportData | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'complete'>('all');

  useEffect(() => {
    if (!code) return;
    api.exportSession(code).then(setData).catch(() => setData(null));
  }, [code]);

  const downloadCSV = () => {
    if (!data) return;
    const blob = new Blob([toCSV(data)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feedback-${data.session.code}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = search.toLowerCase();
    return data.feedback.filter((f) => {
      if (filter === 'complete' && !f.response) return false;
      if (!term) return true;
      return (
        f.user.name.toLowerCase().includes(term) ||
        f.user.email.toLowerCase().includes(term) ||
        (f.question?.toLowerCase().includes(term) ?? false) ||
        (f.response?.toLowerCase().includes(term) ?? false)
      );
    });
  }, [data, search, filter]);

  if (!data) {
    return (
      <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted p-10 text-center">
        {'>'} Loading_Export
      </div>
    );
  }

  const totalEvals = totalEvaluations(data);
  const payload = payloadScore([...data.feedback, ...data.defaultFeedback]);
  const ai = aiCompliance([...data.feedback, ...data.defaultFeedback]);
  const nodes = totalNodesProcessed(data);

  return (
    <>
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4 mb-6">
        <div>
          <div className="term-label">[Results]</div>
          <h1 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-1">
            Results &amp; Export
          </h1>
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
            {data.session.presentation} &nbsp;·&nbsp; Code: {data.session.code} &nbsp;·&nbsp; {data.session.status}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadCSV} className="term-button-secondary">
            <span className="material-symbols-outlined text-[16px]">download</span>
            Export_Csv
          </button>
          <Link to={`/admin/sessions/${code}/analytics`} className="term-button-primary">
            <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
            Analysis
          </Link>
          <Link to={`/admin/sessions/${code}`} className="term-button-secondary">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back
          </Link>
        </div>
      </div>

      {/* KPI scorecards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border mb-6">
        {[
          {
            label: 'Total_Evaluations',
            value: totalEvals.toLocaleString(),
            unit: '/ 100',
            color: 'text-on-surface',
          },
          {
            label: 'Payload_Score',
            value: payload.toFixed(1),
            unit: '/ 100',
            color: 'text-primary',
          },
          {
            label: 'Ai_Compliance',
            value: ai.toFixed(1),
            unit: '%',
            color: 'text-on-surface',
          },
          {
            label: 'Total_Nodes',
            value: nodes.toLocaleString(),
            unit: 'processed',
            color: 'text-on-surface',
          },
        ].map((k) => (
          <div key={k.label} className="bg-surface p-4">
            <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[{k.label}]</div>
            <div className={`font-mono text-display-sm mt-2 ${k.color}`}>{k.value}</div>
            <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">{k.unit}</div>
          </div>
        ))}
      </div>

      {/* Filter + search row */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setFilter('all')}
          className={`font-mono text-micro uppercase tracking-[0.15em] px-3 py-1.5 border ${
            filter === 'all' ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-muted hover:text-on-surface'
          }`}
        >
          [Filter: All]
        </button>
        <button
          onClick={() => setFilter('complete')}
          className={`font-mono text-micro uppercase tracking-[0.15em] px-3 py-1.5 border ${
            filter === 'complete' ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-muted hover:text-on-surface'
          }`}
        >
          [Filter: Complete]
        </button>
        <div className="flex-1" />
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-muted text-[18px]">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="term-input pl-8 pr-3 py-1.5 text-body"
            placeholder="Search_Id_Or_Participant"
          />
        </div>
      </div>

      {data.feedback.length === 0 ? (
        <div className="term-card text-center py-10">
          <span className="material-symbols-outlined text-4xl text-muted">inbox</span>
          <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-3">
            No_Feedback_Collected
          </h2>
          <p className="font-body text-body text-on-surface-variant mt-1">
            Responses will appear here once participants submit.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block term-card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-1 text-left font-mono text-micro uppercase tracking-[0.18em] text-muted">
                  {['Slide', 'Name', 'Email', 'Question', 'Type', 'Response', 'Submitted'].map((h) => (
                    <th key={h} className="px-3 py-2 border-b border-border">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((f, i) => (
                  <tr key={i} className="term-table-row">
                    <td className="px-3 py-2 font-mono text-body text-on-surface">{f.slideNumber}</td>
                    <td className="px-3 py-2 font-mono text-body text-on-surface">{f.user.name}</td>
                    <td className="px-3 py-2 font-mono text-body text-on-surface-variant">{f.user.email}</td>
                    <td className="px-3 py-2 font-mono text-body text-on-surface-variant">{f.question ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-micro uppercase tracking-[0.15em] border border-primary text-primary px-1.5 py-0.5">
                        {f.feedbackType}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-body text-on-surface">{f.response ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-micro uppercase tracking-[0.18em] text-muted">
                      {new Date(f.submittedAt).toISOString().slice(0, 19).replace('T', ' ')}Z
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-px bg-border border border-border">
            {filtered.map((f, i) => (
              <div key={i} className="bg-surface p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                    Slide {f.slideNumber}
                  </span>
                  <span className="font-mono text-micro uppercase tracking-[0.15em] border border-primary text-primary px-1.5 py-0.5">
                    {f.feedbackType}
                  </span>
                </div>
                <p className="font-mono text-body text-on-surface mb-1">
                  {f.user.name} &nbsp;·&nbsp; {f.user.email}
                </p>
                {f.question && (
                  <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mb-1">{f.question}</p>
                )}
                <p className="font-mono text-body text-on-surface">{f.response ?? '—'}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Default-question responses */}
      {data.defaultQuestions.length > 0 && (
        <section className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-primary">stars</span>
            <h2 className="font-mono text-h1 uppercase tracking-[-0.01em] text-on-surface">
              Default_Responses
            </h2>
          </div>

          {data.defaultFeedback.length === 0 ? (
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              {'>'} No default-question responses collected.
            </p>
          ) : (
            <div className="hidden md:block term-card overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-1 text-left font-mono text-micro uppercase tracking-[0.18em] text-muted">
                    {['Slide', 'Name', 'Email', 'Question', 'Type', 'Response', 'Submitted'].map((h) => (
                      <th key={h} className="px-3 py-2 border-b border-border">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.defaultFeedback.map((f, i) => (
                    <tr key={i} className="term-table-row">
                      <td className="px-3 py-2 font-mono text-body text-on-surface">{f.slideNumber}</td>
                      <td className="px-3 py-2 font-mono text-body text-on-surface">{f.user.name}</td>
                      <td className="px-3 py-2 font-mono text-body text-on-surface-variant">{f.user.email}</td>
                      <td className="px-3 py-2 font-mono text-body text-on-surface-variant">{f.question}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-micro uppercase tracking-[0.15em] border border-primary text-primary px-1.5 py-0.5">
                          {f.questionType}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-body text-on-surface capitalize">{f.response ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-micro uppercase tracking-[0.18em] text-muted">
                        {new Date(f.submittedAt).toISOString().slice(0, 19).replace('T', ' ')}Z
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="md:hidden flex flex-col gap-px bg-border border border-border mt-3">
            {data.defaultFeedback.map((f, i) => (
              <div key={i} className="bg-surface p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                    Slide {f.slideNumber}
                  </span>
                  <span className="font-mono text-micro uppercase tracking-[0.15em] border border-primary text-primary px-1.5 py-0.5">
                    {f.questionType}
                  </span>
                </div>
                <p className="font-mono text-body text-on-surface mb-1">
                  {f.user.name} &nbsp;·&nbsp; {f.user.email}
                </p>
                <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mb-1">{f.question}</p>
                <p className="font-mono text-body text-on-surface capitalize">{f.response ?? '—'}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
