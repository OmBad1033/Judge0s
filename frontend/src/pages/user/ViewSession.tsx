import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { usePresentationSocket } from '../../usePresentationSocket';
import type { SlideEvent, SlideEventRule, StoredResponse, StoredDefaultResponse, ParticipantState } from '../../types';
import FeedbackForm from '../../components/FeedbackForm';
import DefaultQuestionForm from '../../components/DefaultQuestionForm';

const ERR_MSG: Record<string, string> = {
  RESUBMISSION_NOT_ALLOWED: "You can't change your response for this slide.",
  RESPONSE_REQUIRED: 'A response is required.',
  INVALID_BOOLEAN: 'Please choose Yes or No.',
  INVALID_CHOICE: 'Please pick one of the options.',
  INVALID_RATING: 'Rating must be a whole number from 0 to 10.',
  RESPONSE_TOO_LONG: 'Response is too long (max 2000 chars).',
  FEEDBACK_DISABLED: 'Feedback is disabled for this slide.',
  SLIDE_OUT_OF_RANGE: 'This question is not active on the current slide.',
};

const mapErr = (e: unknown) => {
  const c = e instanceof ApiError ? e.message : 'Submission failed';
  return ERR_MSG[c] ?? c;
};

// Page 2 of the participation flow: the in-session view that shows the
// active slide, configured feedback form, any default questions, and a
// single submit button that saves everything together (per project taste).
export default function ViewSession() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [pid, setPid] = useState<string | null>(null);
  const [boot, setBoot] = useState<ParticipantState | null>(null);
  const [responses, setResponses] = useState<StoredResponse[]>([]);
  const [defaultResponses, setDefaultResponses] = useState<StoredDefaultResponse[]>([]);
  const { event: wsEvent, connected } = usePresentationSocket(code);

  const [slideValue, setSlideValue] = useState('');
  const [defaultValues, setDefaultValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: 'idle' | 'ok' | 'error' | 'submitting'; message?: string }>({ kind: 'idle' });

  const bootstrap = useCallback(async () => {
    if (!code) return;
    const stored = localStorage.getItem('participant');
    if (!stored) {
      navigate(`/join?code=${code}`);
      return;
    }
    let p: { participantId: string; code: string };
    try {
      p = JSON.parse(stored);
    } catch {
      navigate(`/join?code=${code}`);
      return;
    }
    if (p.code !== code) {
      navigate(`/join?code=${code}`);
      return;
    }
    setPid(p.participantId);
    try {
      const state = await api.participantState(code, p.participantId);
      setBoot(state);
      setResponses(state.responses);
      setDefaultResponses(state.defaultResponses);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) navigate(`/join?code=${code}`);
    }
  }, [code, navigate]);
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const event: SlideEvent | null = wsEvent ?? boot?.event ?? null;
  const sessionStatus = boot?.session.status ?? null;
  const slideNumber = event?.type === 'SLIDE_CHANGED' ? event.slideNumber : boot?.session.currentSlideNumber ?? null;
  const rule: SlideEventRule | null = event?.type === 'SLIDE_CHANGED' ? (event.feedbackRule ?? null) : null;
  const defaultQuestions = event?.type === 'SLIDE_CHANGED' ? (event.defaultQuestions ?? []) : [];
  const existing = slideNumber != null ? responses.find((r) => r.slideNumber === slideNumber) ?? null : null;
  const locked = !!existing && !(rule?.allowResubmission ?? false);

  useEffect(() => {
    if (slideNumber == null) return;
    const ex = responses.find((r) => r.slideNumber === slideNumber);
    setSlideValue(ex?.responseValue ?? '');
    const dvs: Record<string, string> = {};
    for (const dq of defaultQuestions) {
      const dr = defaultResponses.find((r) => r.defaultQuestionId === dq.id && r.slideNumber === slideNumber);
      dvs[dq.id] = dr?.responseValue ?? '';
    }
    setDefaultValues(dvs);
    setStatus({ kind: 'idle' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideNumber, event]);

  const ended = event?.type === 'SESSION_ENDED' || sessionStatus === 'ended';
  const waiting = event?.type === 'NO_ACTIVE_SLIDE';
  const active = event?.type === 'SLIDE_CHANGED';
  const hasContent = !!(active && (event!.slide?.title || event!.slide?.summary));
  const slideSubmittable = !!rule?.enabled && rule.type !== 'disabled' && !locked;
  const canSubmit = slideSubmittable || defaultQuestions.length > 0;

  const submitAll = async () => {
    if (!code || !pid || slideNumber == null) return;
    setStatus({ kind: 'submitting' });
    const errs: string[] = [];

    if (slideSubmittable) {
      try {
        const res = await api.submitFeedback(code, pid, slideNumber, slideValue);
        setResponses((rs) => [...rs.filter((r) => r.slideNumber !== slideNumber), res].sort((a, b) => a.slideNumber - b.slideNumber));
      } catch (e) {
        errs.push(mapErr(e));
      }
    }

    for (const dq of defaultQuestions) {
      const v = defaultValues[dq.id];
      if (!v) continue;
      try {
        const res = await api.submitDefaultFeedback(code, pid, dq.id, slideNumber, v);
        setDefaultResponses((rs) => [...rs.filter((r) => !(r.defaultQuestionId === dq.id && r.slideNumber === slideNumber)), res]);
      } catch (e) {
        errs.push(mapErr(e));
      }
    }

    if (errs.length) {
      setStatus({ kind: 'error', message: errs[0] });
    } else {
      setStatus({ kind: 'ok', message: 'Responses saved' });
    }
  };

  if (!event) {
    return (
      <div className="min-h-screen dot-grid flex items-center justify-center text-on-surface font-mono gap-2 text-label uppercase tracking-[0.15em]">
        <span className="text-primary">{'>'}</span>
        <span>Connecting</span>
        <span className="cursor-blink">_</span>
      </div>
    );
  }

  return (
    <div className="dot-grid min-h-screen text-on-surface font-body relative">
      {!connected && (
        <div className="fixed top-0 left-0 w-full z-50 bg-danger text-on-danger flex justify-center items-center py-2 px-4 gap-2 font-mono text-micro uppercase tracking-[0.18em]">
          <span className="material-symbols-outlined text-[16px]">wifi_tethering_error</span>
          <span>{'>'} Ws_Link:Down — Reconnecting</span>
        </div>
      )}

      <main className="w-full max-w-md mx-auto min-h-screen flex flex-col px-4 pt-4 pb-8 gap-4">
        {/* Top status strip */}
        <header className="flex items-center justify-between border border-border bg-surface px-3 py-2">
          <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
            [Session_Id: {code}]
          </span>
          <span
            className={`flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.18em] px-2 py-0.5 border ${
              ended
                ? 'border-danger text-danger bg-[#fef2f2]'
                : connected
                  ? 'border-primary text-primary bg-primary-dim'
                  : 'border-warning text-warning'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full inline-block ${
                ended ? 'bg-danger' : connected ? 'bg-primary pulse-emerald' : 'bg-warning pulse-emerald'
              }`}
            />
            {ended ? 'Ended' : connected ? 'Live' : 'Reconnecting'}
          </span>
        </header>

        {/* Slide badge */}
        <div className="border border-border bg-surface px-3 py-2 flex items-center justify-between">
          <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Active_Slide]</span>
          <span className="font-mono text-h1 text-on-surface">
            {String(slideNumber ?? '—').padStart(2, '0')}
          </span>
        </div>

        {ended && (
          <section className="border border-border bg-surface p-6 flex flex-col items-center justify-center text-center gap-3">
            <span className="material-symbols-outlined text-3xl text-danger">stop_circle</span>
            <div>
              <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface">
                Session_Terminated
              </h2>
              <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
                {'>'} Thank you for your feedback.
              </p>
            </div>
          </section>
        )}

        {waiting && !ended && (
          <section className="border border-border bg-surface p-6 flex flex-col items-center justify-center text-center gap-3">
            <div className="relative w-12 h-12 flex items-center justify-center">
              <div className="absolute inset-0 border-2 border-border border-t-primary animate-spin" />
              <span className="material-symbols-outlined text-2xl text-muted">hourglass_empty</span>
            </div>
            <div>
              <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface">
                Awaiting_Presenter
              </h2>
              <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
                {'>'} The presentation will begin shortly. Keep this screen open.
              </p>
            </div>
          </section>
        )}

        {active && !ended && (
          <section className="flex flex-col gap-4">
            {/* Slide card */}
            <div className="border border-border bg-surface">
              <div className="border-b border-border px-4 py-2">
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">[Query_Data]</span>
              </div>
              <div className="px-4 py-4">
                {hasContent ? (
                  <>
                    {event!.slide?.title && (
                      <h1 className="font-mono text-h1 text-on-surface mb-px uppercase tracking-[-0.01em]">
                        {event!.slide.title}
                      </h1>
                    )}
                    {event!.slide?.summary && (
                      <p className="font-body text-body text-on-surface-variant mt-1">
                        {event!.slide.summary}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="text-center py-4">
                    <span className="material-symbols-outlined text-3xl text-muted">visibility_off</span>
                    <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted mt-1">
                      {'>'} No_Query
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Slide feedback form */}
            {rule?.enabled && rule.type !== 'disabled' && (
              locked ? (
                <div className="border border-border bg-surface p-6 flex flex-col items-center justify-center text-center gap-2">
                  <span className="material-symbols-outlined text-3xl text-primary">check_circle</span>
                  <p className="font-mono text-body text-on-surface">
                    You answered: <span className="font-medium capitalize">{existing?.responseValue ?? '—'}</span>
                  </p>
                  <p className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                    {'>'} This slide does not allow changes.
                  </p>
                </div>
              ) : (
                <FeedbackForm rule={rule} value={slideValue} onChange={setSlideValue} />
              )
            )}

            {/* Default questions */}
            {defaultQuestions.map((dq) => (
              <DefaultQuestionForm
                key={dq.id}
                question={dq}
                value={defaultValues[dq.id] ?? ''}
                onChange={(v) => setDefaultValues((prev) => ({ ...prev, [dq.id]: v }))}
              />
            ))}

            {/* Submit */}
            {canSubmit && (
              <div className="flex flex-col gap-2 mt-2">
                <button
                  onClick={submitAll}
                  disabled={status.kind === 'submitting'}
                  className="term-button-primary w-full !py-3.5"
                >
                  {status.kind === 'submitting' ? (
                    <>
                      <span>{'>'}</span>
                      Submitting
                      <span className="cursor-blink">_</span>
                    </>
                  ) : (
                    <>
                      <span>Submit_Response</span>
                      <span className="material-symbols-outlined text-[18px]">send</span>
                    </>
                  )}
                </button>
                {status.kind === 'ok' && (
                  <p className="flex items-center gap-1 font-mono text-micro uppercase tracking-[0.15em] text-primary">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    {'>'} {status.message}
                  </p>
                )}
                {status.kind === 'error' && (
                  <p className="flex items-center gap-1 font-mono text-micro uppercase tracking-[0.15em] text-danger">
                    <span className="material-symbols-outlined text-[16px]">error</span>
                    {'>'} {status.message}
                  </p>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
