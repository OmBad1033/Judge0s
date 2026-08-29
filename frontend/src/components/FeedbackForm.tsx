import type { SlideEventRule } from '../types';

interface Props {
  rule: SlideEventRule;
  value: string;
  onChange: (value: string) => void;
}

// Controlled input-only — submit is handled by the parent (single submit
// saves slide feedback + default answers together per project taste).
export default function FeedbackForm({ rule, value, onChange }: Props) {
  if (!rule.enabled || rule.type === 'disabled') return null;

  const options =
    rule.type === 'boolean' ? ['yes', 'no'] : rule.type === 'multiple_choice' ? (rule.options ?? []) : [];

  return (
    <div className="term-card">
      {rule.question && (
        <div className="px-4 pt-4 pb-3 border-b border-border">
          <div className="term-label-strong mb-1.5">[Query]</div>
          <p className="font-mono text-body text-on-surface leading-snug">{rule.question}</p>
        </div>
      )}

      {(rule.type === 'boolean' || rule.type === 'multiple_choice') && (
        <div className="p-3 flex flex-col gap-2">
          {options.map((opt, i) => {
            const selected = value === opt;
            const label = String.fromCharCode(65 + i);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(opt)}
                className={`group relative flex items-center gap-3 px-4 py-3 border text-left transition ${
                  selected
                    ? 'border-primary bg-primary-dim/40'
                    : 'border-border hover:border-primary hover:bg-surface-1'
                }`}
              >
                <span
                  className={`font-mono text-micro uppercase tracking-[0.15em] w-6 shrink-0 ${
                    selected ? 'text-primary' : 'text-muted'
                  }`}
                >
                  {label}.
                </span>
                <span
                  className={`font-mono text-body flex-1 capitalize ${selected ? 'text-on-surface' : 'text-on-surface-variant'}`}
                >
                  {opt}
                </span>
                <span
                  className={`material-symbols-outlined text-[18px] ${selected ? 'text-primary' : 'text-transparent'}`}
                >
                  {selected ? 'check_circle' : 'radio_button_unchecked'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {rule.type === 'open_text' && (
        <div className="p-4 relative">
          <textarea
            className="term-input px-3 py-2 min-h-[120px] resize-none"
            value={value}
            maxLength={2000}
            placeholder="> Type your response…"
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="absolute bottom-6 right-6 font-mono text-micro uppercase tracking-[0.15em] text-muted bg-surface border border-border px-1.5 py-0.5">
            {value.length} / 2000
          </div>
        </div>
      )}
    </div>
  );
}
