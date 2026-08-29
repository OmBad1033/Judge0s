import type { DefaultQuestionDto } from '../types';

interface Props {
  question: DefaultQuestionDto;
  value: string;
  onChange: (value: string) => void;
}

// Controlled input-only — saved with the slide feedback via the parent's
// single submit (per project taste).
export default function DefaultQuestionForm({ question, value, onChange }: Props) {
  return (
    <div className="term-card">
      <div className="px-4 pt-4 pb-3 border-b border-border flex items-center gap-2">
        <span className="font-mono text-micro uppercase tracking-[0.18em] text-primary">[Default_Query]</span>
        <p className="font-mono text-body text-on-surface leading-snug flex-1">{question.questionText}</p>
      </div>

      {question.questionType === 'interested' && (
        <div className="p-3 grid grid-cols-2 gap-2">
          {[
            { v: 'interested', label: 'Interested' },
            { v: 'not_interested', label: 'Not Interested' },
          ].map((opt) => {
            const selected = value === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => onChange(opt.v)}
                className={`flex items-center justify-center gap-2 py-3 border font-mono text-label uppercase tracking-[0.15em] transition ${
                  selected
                    ? 'border-primary bg-primary-dim/40 text-on-surface'
                    : 'border-border text-muted hover:border-primary hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {opt.v === 'interested' ? 'thumb_up' : 'thumb_down'}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {question.questionType === 'rating' && (
        <div className="p-3">
          <div className="grid grid-cols-11 gap-1">
            {Array.from({ length: 11 }, (_, n) => {
              const selected = value === String(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => onChange(String(n))}
                  className={`h-9 border font-mono text-label transition ${
                    selected
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-border text-muted hover:border-primary hover:text-on-surface'
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 font-mono text-micro uppercase tracking-[0.18em] text-muted">
            <span>0 - Low</span>
            <span>10 - High</span>
          </div>
        </div>
      )}
    </div>
  );
}
