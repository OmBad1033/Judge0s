import { Box, Flex, Text } from '@chakra-ui/react';

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected' | 'ended';

interface Props {
  state: ConnectionState;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const STATE_CONFIG: Record<
  ConnectionState,
  { color: string; dotBg: string; pulse: boolean; label: string }
> = {
  connected: { color: 'green.solid', dotBg: 'green.solid', pulse: true, label: 'Live' },
  reconnecting: { color: 'orange.solid', dotBg: 'orange.solid', pulse: true, label: 'Reconnecting' },
  disconnected: { color: 'red.solid', dotBg: 'red.solid', pulse: false, label: 'Offline' },
  ended: { color: 'red.solid', dotBg: 'red.solid', pulse: false, label: 'Ended' },
};

export default function ConnectionStatus({ state, size = 'sm', showLabel = true }: Props) {
  const cfg = STATE_CONFIG[state];
  const dotSize = size === 'md' ? 8 : 6;

  return (
    <Flex
      align="center"
      gap="1.5"
      px={size === 'md' ? '3' : '2'}
      py={size === 'md' ? '1.5' : '0.5'}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="full"
      bg="bg.surface"
      role="status"
      aria-live="polite"
      aria-label={`Connection: ${cfg.label}`}
      w="fit-content"
    >
      <Box
        w={`${dotSize}px`}
        h={`${dotSize}px`}
        borderRadius="full"
        bg={cfg.dotBg}
        animation={cfg.pulse ? 'pulse-dot 1.4s ease-in-out infinite' : undefined}
      />
      {showLabel && (
        <Text color={cfg.color} fontSize="xs" textTransform="uppercase" letterSpacing="wider" fontWeight="medium">
          {cfg.label}
        </Text>
      )}
    </Flex>
  );
}
