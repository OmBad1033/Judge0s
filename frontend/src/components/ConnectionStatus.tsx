import type { ReactNode } from 'react';

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected' | 'ended';

interface Props {
  state: ConnectionState;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}

const STATE_CONFIG: Record<
  ConnectionState,
  { color: string; bg: string; dot: string; pulse: boolean; label: string }
> = {
  connected: {
    color: 'text-primary',
    bg: 'border-primary bg-primary-dim',
    dot: 'bg-primary',
    pulse: true,
    label: 'Live',
  },
  reconnecting: {
    color: 'text-warning',
    bg: 'border-warning bg-[#fef3c7]',
    dot: 'bg-warning',
    pulse: true,
    label: 'Reconnecting',
  },
  disconnected: {
    color: 'text-danger',
    bg: 'border-danger bg-[#fef2f2]',
    dot: 'bg-danger',
    pulse: false,
    label: 'Offline',
  },
  ended: {
    color: 'text-danger',
    bg: 'border-danger bg-[#fef2f2]',
    dot: 'bg-danger',
    pulse: false,
    label: 'Ended',
  },
};

export default function ConnectionStatus({ state, size = 'sm', showLabel = true, className = '' }: Props) {
  const cfg = STATE_CONFIG[state];
  const padding = size === 'md' ? 'px-3 py-1.5' : 'px-2 py-0.5';
  const dotSize = size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5';

  const content: ReactNode = (
    <>
      <span className={`${dotSize} rounded-full inline-block ${cfg.dot} ${cfg.pulse ? 'pulse-emerald' : ''}`} />
      {showLabel && (
        <span className="font-mono text-micro uppercase tracking-[0.18em]">{cfg.label}</span>
      )}
    </>
  );

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.18em] ${padding} border ${cfg.bg} ${cfg.color} ${className}`}
      role="status"
      aria-live="polite"
      aria-label={`Connection: ${cfg.label}`}
    >
      {content}
    </span>
  );
}