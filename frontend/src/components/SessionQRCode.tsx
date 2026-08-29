import { QRCodeSVG } from 'qrcode.react';
import { useMemo } from 'react';

interface Props {
  code: string;
  size?: number;
  caption?: string;
  className?: string;
}

/**
 * QR code that encodes the deep-link join URL for the session — so a participant
 * scanning with their phone camera lands directly on `/join/:code` (no typing).
 */
export default function SessionQRCode({ code, size = 220, caption, className = '' }: Props) {
  const joinUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/join/${encodeURIComponent(code)}`;
  }, [code]);

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="p-3 bg-white border border-border">
        <QRCodeSVG
          value={joinUrl}
          size={size}
          bgColor="#ffffff"
          fgColor="#0a0a0a"
          level="M"
          includeMargin={false}
        />
      </div>
      {caption && <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">{caption}</span>}
    </div>
  );
}