import { Badge, type BadgeProps } from '@chakra-ui/react';

type SessionStatus = 'draft' | 'live' | 'paused' | 'ended';

const STATUS_TONE: Record<SessionStatus, BadgeProps['colorPalette']> = {
  draft: 'gray',
  live: 'green',
  paused: 'orange',
  ended: 'red',
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <Badge colorPalette={STATUS_TONE[status]} variant="surface" size="sm" textTransform="uppercase">
      {label}
    </Badge>
  );
}
