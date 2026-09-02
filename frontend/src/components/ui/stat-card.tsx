import { Box, HStack, Stat, StatLabel, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}

export function StatCard({ label, value, sub, icon }: StatCardProps) {
  return (
    <Stat.Root borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="4">
      <HStack gap="2" color="fg.muted">
        {icon}
        <StatLabel textTransform="uppercase" fontSize="xs" letterSpacing="wider" fontWeight="medium">
          {label}
        </StatLabel>
      </HStack>
      <Stat.ValueText mt="2" fontSize="2xl" fontWeight="semibold">
        {value}
      </Stat.ValueText>
      {sub && (
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mt="1">
          {sub}
        </Text>
      )}
    </Stat.Root>
  );
}
