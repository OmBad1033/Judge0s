interface Props {
  className?: string;
  rows?: number;
  variant?: 'card' | 'list' | 'text';
}

/**
 * Lightweight loading placeholder that uses the same hairline + mono vibe as the rest of the app.
 * Renders shimmer lines without external animation libraries.
 */
export default function Skeleton({ className = '', rows = 1, variant = 'text' }: Props) {
  if (variant === 'card') {
    return (
      <div className={`term-card p-4 flex flex-col gap-3 ${className}`} aria-hidden="true">
        <div className="h-4 w-1/3 bg-surface-2 animate-pulse" />
        <div className="h-3 w-2/3 bg-surface-2 animate-pulse" />
        <div className="h-3 w-1/2 bg-surface-2 animate-pulse" />
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="term-card p-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-surface-2 animate-pulse" />
            <div className="flex-1 flex flex-col gap-1.5">
              <div className="h-3 w-1/3 bg-surface-2 animate-pulse" />
              <div className="h-2.5 w-1/2 bg-surface-2 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3 bg-surface-2 animate-pulse" style={{ width: `${100 - i * 8}%` }} />
      ))}
    </div>
  );
}