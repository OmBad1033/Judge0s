import { Box, EmptyState, EmptyStateContent, EmptyStateDescription, EmptyStateIndicator, EmptyStateTitle, VStack } from '@chakra-ui/react';
import type { ReactNode } from 'react';

interface EmptyStateCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}

export function EmptyStateCard({ icon, title, description, children }: EmptyStateCardProps) {
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface">
      <EmptyState.Root textAlign="center" py="12">
        <EmptyStateContent>
          <EmptyStateIndicator>{icon}</EmptyStateIndicator>
          <EmptyStateTitle textTransform="uppercase" letterSpacing="wide" fontSize="lg">
            {title}
          </EmptyStateTitle>
          <EmptyStateDescription>{description}</EmptyStateDescription>
          {children && (
            <VStack gap="3" mt="2">
              {children}
            </VStack>
          )}
        </EmptyStateContent>
      </EmptyState.Root>
    </Box>
  );
}
