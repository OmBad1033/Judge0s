import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError, type PutSlideBody } from '../../api';
import type { Presentation, FeedbackType, SlideEventRule, DefaultQuestion, DefaultQuestionType } from '../../types';

const TYPES: { value: FeedbackType; label: string; icon: string }[] = [
  { value: 'disabled', label: 'None', icon: 'block' },
  { value: 'boolean', label: 'Yes / No', icon: 'toggle_on' },
  { value: 'multiple_choice', label: 'Choice', icon: 'checklist' },
  { value: 'open_text', label: 'Text', icon: 'chat' },
];

interface Draft {
  title: string;
  summary: string;
  enabled: boolean;
  required: boolean;
  type: FeedbackType;
  question: string;
  options: string[];
  allowResubmission: boolean;
  saved: boolean;
  dirty: boolean;
}

export default function ConfigureSlides() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [defaultQuestions, setDefaultQuestions] = useState<DefaultQuestion[]>([]);
  const [dqText, setDqText] = useState('');
  const [dqType, setDqType] = useState<DefaultQuestionType>('interested');
  const [dqAll, setDqAll] = useState(true);
  const [dqSelected, setDqSelected] = useState<number[]>([]);
  const [dqBusy, setDqBusy] = useState(false);

  const loadDefaultQuestions = () => {
    if (!id) return;
    api.listDefaultQuestions(id).then((r) => setDefaultQuestions(r.defaultQuestions)).catch(() => {});
  };
  useEffect(loadDefaultQuestions, [id]);

  useEffect(() => {
    if (!id) return;
    api.listSlides(id).then(({ presentation, slides }) => {
      setPresentation(presentation);
      const byNum = new Map(slides.map((s) => [s.slideNumber, s]));
      setDrafts(
        Array.from({ length: presentation.slideCount }, (_, i) => {
          const s = byNum.get(i + 1);
          const r = s?.feedbackRule;
          return {
            title: s?.title ?? '',
            summary: s?.summary ?? '',
            enabled: r?.enabled ?? false,
            required: r?.required ?? false,
            type: r?.feedbackType ?? 'disabled',
            question: r?.question ?? '',
            options: r?.options ?? [],
            allowResubmission: r?.allowResubmission ?? false,
            saved: !!s,
            dirty: false,
          };
        }),
      );
    });
  }, [id]);

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((dr, idx) => (idx === i ? { ...dr, ...patch, dirty: true } : dr)));

  const save = async (i: number) => {
    const d = drafts[i];
    if (!id) return;
    const body: PutSlideBody = {
      title: d.title || undefined,
      summary: d.summary,
      feedbackRule: {
        enabled: d.enabled,
        required: d.required,
        feedbackType: d.type,
        question: d.question || undefined,
        options: d.type === 'multiple_choice' ? d.options.map((o) => o.trim()).filter(Boolean) : undefined,
        allowResubmission: d.allowResubmission,
      },
    };
    try {
      await api.putSlide(id, i + 1, body);
      update(i, { saved: true, dirty: false });
      setMsg({ kind: 'ok', text: `Slide ${i + 1} saved` });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'Save failed' });
    }
  };

  const createSession = async () => {
    if (!id) return;
    try {
      const s = await api.createSession(id);
      navigate(`/admin/sessions/${s.sessionCode}`);
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'Failed to create session' });
    }
  };

  const targetSlides = dqAll ? Array.from({ length: presentation?.slideCount ?? 0 }, (_, i) => i + 1) : dqSelected;

  const addDefaultQuestion = async () => {
    if (!id || !dqText.trim()) return;
    if (!dqAll && dqSelected.length === 0) {
      setMsg({ kind: 'error', text: 'Select at least one slide for the default question.' });
      return;
    }
    setDqBusy(true);
    try {
      await api.createDefaultQuestion(id, { questionText: dqText.trim(), questionType: dqType, targetSlides });
      setDqText('');
      setDqSelected([]);
      loadDefaultQuestions();
      setMsg({ kind: 'ok', text: 'Default question added' });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'Failed to add default question' });
    } finally {
      setDqBusy(false);
    }
  };

  const removeDefaultQuestion = async (qid: string) => {
    if (!id) return;
    try {
      await api.deleteDefaultQuestion(id, qid);
      loadDefaultQuestions();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'Failed to remove' });
    }
  };

  const toggleSlide = (n: number) =>
    setDqSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n].sort((a, b) => a - b)));

  if (!presentation) {
    return (
      <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted p-10 text-center">
        {'>'} Loading_Configuration
      </div>
    );
  }
  const d = drafts[active];

  const previewRule: SlideEventRule = {
    enabled: d.enabled && d.type !== 'disabled',
    required: d.required,
    type: d.type,
    question: d.question || null,
    options: d.type === 'multiple_choice' ? d.options : null,
    allowResubmission: d.allowResubmission,
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4 mb-6">
        <div>
          <div className="term-label">[Slide_Config]</div>
          <h1 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-1">
            {presentation.title}
          </h1>
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
            {presentation.slideCount} Slides &nbsp;·&nbsp; Configure content and feedback
          </p>
        </div>
        <button onClick={createSession} className="term-button-primary">
          <span className="material-symbols-outlined text-[18px]">sensors</span>
          Create_Session
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-px bg-border border border-border">
        <aside className="lg:col-span-3 bg-surface p-4">
          <div className="term-label mb-3">[Slides]</div>
          <div className="flex lg:flex-col gap-px bg-border lg:bg-transparent border lg:border-0 border-border overflow-x-auto lg:overflow-visible">
            {drafts.map((dr, i) => {
              const isActive = active === i;
              return (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  className={`shrink-0 lg:w-full text-left flex items-center gap-2 lg:gap-3 p-2.5 border transition ${
                    isActive
                      ? 'border-primary bg-primary-dim/30'
                      : 'border-border lg:border-transparent bg-surface hover:border-primary'
                  }`}
                >
                  <span
                    className={`w-7 h-7 inline-flex items-center justify-center font-mono text-micro uppercase tracking-[0.15em] ${
                      isActive ? 'bg-primary text-on-primary' : 'bg-surface-1 text-muted border border-border'
                    }`}
                  >
                    {isActive ? '>' : String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="font-mono text-body text-on-surface truncate flex-1 hidden lg:block">
                    {dr.title || `Untitled_${String(i + 1).padStart(2, '0')}`}
                  </span>
                  {dr.dirty ? (
                    <span className="material-symbols-outlined text-[16px] text-warning" title="Unsaved">edit_note</span>
                  ) : dr.saved ? (
                    <span className="material-symbols-outlined text-[16px] text-primary" title="Saved">check_circle</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="lg:col-span-5 bg-surface p-5">
          <div className="flex items-center gap-2 mb-4 border-b border-border pb-3">
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Slide]</span>
            <h2 className="font-mono text-h1 text-on-surface">{String(active + 1).padStart(2, '0')}</h2>
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              / {String(presentation.slideCount).padStart(2, '0')}
            </span>
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <label className="term-label block mb-1.5">[Title] (Optional)</label>
              <input
                className="term-input px-3 py-2"
                value={d.title}
                onChange={(e) => update(active, { title: e.target.value })}
                placeholder="Slide title"
              />
            </div>
            <div>
              <label className="term-label block mb-1.5">[Summary]</label>
              <textarea
                className="term-input px-3 py-2 min-h-[80px] resize-none"
                value={d.summary}
                onChange={(e) => update(active, { summary: e.target.value })}
                placeholder="What participants see for this slide"
              />
            </div>
            <div>
              <label className="term-label block mb-2">[Input_Modality]</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border border-border">
                {TYPES.map((t) => {
                  const selected = d.type === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => update(active, { type: t.value, enabled: t.value !== 'disabled' })}
                      className={`flex flex-col items-center gap-1 p-3 font-mono text-micro uppercase tracking-[0.15em] transition ${
                        selected ? 'bg-primary text-on-primary' : 'bg-surface text-muted hover:bg-surface-1 hover:text-on-surface'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {d.type !== 'disabled' && (
              <>
                <div>
                  <label className="term-label block mb-1.5">[Prompt_Text]</label>
                  <input
                    className="term-input px-3 py-2"
                    value={d.question}
                    onChange={(e) => update(active, { question: e.target.value })}
                    placeholder="Ask participants something"
                  />
                </div>
                {d.type === 'multiple_choice' && (
                  <div>
                    <label className="term-label block mb-1.5">[Scoring_Vectors]</label>
                    <div className="border border-border">
                      <div className="grid grid-cols-[40px_1fr_60px_40px] gap-px bg-border font-mono text-micro uppercase tracking-[0.18em] text-muted">
                        <span className="bg-surface-1 px-2 py-1.5">Idx</span>
                        <span className="bg-surface-1 px-2 py-1.5">Label</span>
                        <span className="bg-surface-1 px-2 py-1.5">Weight</span>
                        <span className="bg-surface-1 px-2 py-1.5">Act</span>
                      </div>
                      <textarea
                        className="term-input px-3 py-2 min-h-[100px] resize-none border-0 focus:ring-0 rounded-none"
                        value={d.options.join('\n')}
                        onChange={(e) => update(active, { options: e.target.value.split('\n') })}
                        placeholder={'Highly Accurate\nPartially Accurate\nInaccurate'}
                      />
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-6 font-mono text-micro uppercase tracking-[0.18em] text-on-surface-variant">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-primary" checked={d.required} onChange={(e) => update(active, { required: e.target.checked })} />
                    Required
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-primary" checked={d.allowResubmission} onChange={(e) => update(active, { allowResubmission: e.target.checked })} />
                    Allow_Resubmission
                  </label>
                </div>
              </>
            )}
            <div className="flex items-center gap-3 pt-2 border-t border-border mt-2">
              <button onClick={() => save(active)} className="term-button-primary">
                <span className="material-symbols-outlined text-[18px]">save</span>
                Save_Slide
              </button>
              {d.dirty && (
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-warning">
                  {'>'} Unsaved_Changes
                </span>
              )}
              {!d.dirty && d.saved && (
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-primary inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">check</span>
                  Saved
                </span>
              )}
            </div>
          </div>
        </section>

        <aside className="lg:col-span-4 bg-surface p-5">
          <div className="term-label mb-3">[Preview_Hud]</div>
          <div className="term-card">
            <div className="border-b border-border px-4 py-3">
              <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                [Slide_N {String(active + 1).padStart(2, '0')}]
              </div>
              {d.title ? (
                <h3 className="font-mono text-h1 text-on-surface mt-1">{d.title}</h3>
              ) : (
                <p className="font-mono text-body text-muted mt-1">No title</p>
              )}
              {d.summary ? (
                <p className="font-body text-body text-on-surface-variant mt-1.5">{d.summary}</p>
              ) : (
                <p className="font-mono text-body text-muted mt-1">No summary</p>
              )}
            </div>
            {previewRule.enabled ? (
              <div className="px-4 py-3">
                {previewRule.question && <p className="font-mono text-body text-on-surface mb-3">{previewRule.question}</p>}
                {previewRule.type === 'boolean' && (
                  <div className="grid grid-cols-2 gap-px bg-border border border-border">
                    {['yes', 'no'].map((o) => (
                      <div key={o} className="bg-surface px-3 py-2 font-mono text-body capitalize text-on-surface-variant">{o}</div>
                    ))}
                  </div>
                )}
                {previewRule.type === 'multiple_choice' && (
                  <div className="flex flex-col gap-px bg-border border border-border">
                    {(previewRule.options ?? []).map((o) => (
                      <div key={o} className="bg-surface px-3 py-2 font-mono text-body text-on-surface-variant">{o}</div>
                    ))}
                    {(previewRule.options ?? []).length === 0 && (
                      <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted">No options</p>
                    )}
                  </div>
                )}
                {previewRule.type === 'open_text' && (
                  <textarea className="term-input px-3 py-2 min-h-[80px] resize-none" rows={3} placeholder="Participant response…" disabled />
                )}
                <div className="mt-3 font-mono text-micro uppercase tracking-[0.18em] text-muted">
                  {previewRule.required ? 'Required' : 'Optional'} &nbsp;·&nbsp; {previewRule.allowResubmission ? 'Resubmission_Allowed' : 'One_Response'}
                </div>
              </div>
            ) : (
              <div className="px-4 py-6 text-center">
                <span className="material-symbols-outlined text-3xl text-muted">visibility_off</span>
                <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">No_Feedback_For_This_Slide</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      <section className="mt-6 term-card">
        <div className="border-b border-border px-5 py-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">stars</span>
          <div>
            <div className="term-label-strong">[Default_Questions]</div>
            <p className="font-body text-body text-on-surface-variant mt-1">
              Generic questions shown on the selected slides in addition to each slide's own feedback.
            </p>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            <label className="term-label block mb-1.5">[Question_Text]</label>
            <input
              className="term-input px-3 py-2"
              value={dqText}
              onChange={(e) => setDqText(e.target.value)}
              placeholder={dqType === 'interested' ? 'Are you interested in this?' : 'Rate this slide'}
            />
          </div>
          <div className="flex flex-wrap gap-6 font-mono text-micro uppercase tracking-[0.18em] text-on-surface-variant">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" className="accent-primary" checked={dqType === 'interested'} onChange={() => setDqType('interested')} />
              <span className="material-symbols-outlined text-[16px]">thumb_up</span>
              Interested / Not_Interested
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" className="accent-primary" checked={dqType === 'rating'} onChange={() => setDqType('rating')} />
              <span className="material-symbols-outlined text-[16px]">linear_scale</span>
              0 - 10 Rating
            </label>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="term-label">[Apply_To]</span>
              <label className="flex items-center gap-2 font-mono text-micro uppercase tracking-[0.18em] cursor-pointer">
                <input type="checkbox" className="accent-primary w-4 h-4" checked={dqAll} onChange={(e) => setDqAll(e.target.checked)} />
                All_Slides
              </label>
            </div>
            {!dqAll && (
              <div className="flex flex-wrap gap-px bg-border border border-border w-fit">
                {Array.from({ length: presentation.slideCount }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggleSlide(n)}
                    className={`w-9 h-9 font-mono text-label uppercase ${dqSelected.includes(n) ? 'bg-primary text-on-primary' : 'bg-surface text-muted hover:bg-surface-1'}`}
                  >
                    {String(n).padStart(2, '0')}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <button onClick={addDefaultQuestion} disabled={dqBusy || !dqText.trim()} className="term-button-primary">
              <span className="material-symbols-outlined text-[18px]">add</span>
              {dqBusy ? 'Adding...' : 'Add_Default_Question'}
            </button>
          </div>
        </div>

        {defaultQuestions.length > 0 && (
          <div className="border-t border-border px-5 py-4 flex flex-col gap-2">
            {defaultQuestions.map((q) => (
              <div key={q.id} className="flex items-center justify-between gap-3 p-3 bg-surface-1 border border-border">
                <div className="min-w-0">
                  <p className="font-mono text-body text-on-surface truncate">{q.questionText}</p>
                  <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                    {q.questionType === 'interested' ? 'Interested / Not_Interested' : '0-10 Rating'} &nbsp;·&nbsp; Slides {q.targetSlides.length === presentation.slideCount ? 'all' : q.targetSlides.join(', ')}
                  </p>
                </div>
                <button onClick={() => removeDefaultQuestion(q.id)} className="text-danger hover:bg-[#fef2f2] p-2 transition" title="Remove">
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {msg && (
        <div className={`fixed bottom-4 right-4 z-50 term-card px-4 py-3 font-mono text-micro uppercase tracking-[0.15em] flex items-center gap-2 ${msg.kind === 'ok' ? 'border-primary text-primary bg-primary-dim' : 'border-danger text-danger bg-[#fef2f2]'}`}>
          <span className="material-symbols-outlined text-[16px]">{msg.kind === 'ok' ? 'check_circle' : 'error'}</span>
          {'>'} {msg.text}
        </div>
      )}
    </>
  );
}
