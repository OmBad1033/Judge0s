import { Box, HStack, SimpleGrid, Skeleton } from '@chakra-ui/react';

export function SkeletonGrid({ columns = 3, rows = 3 }: { columns?: number; rows?: number }) {
  return (
    <SimpleGrid columns={{ base: 1, sm: 2, lg: columns }} gap="4">
      {Array.from({ length: rows }).map((_, i) => (
        <Box key={i} borderWidth="1px" borderColor="border.subtle" borderRadius="lg" p="5" bg="bg.surface">
          <HStack justify="space-between" mb="4">
            <Skeleton h="3" w="16" />
            <Skeleton h="5" w="14" borderRadius="full" />
          </HStack>
          <Skeleton h="4" w="3/4" mb="2" />
          <Skeleton h="3" w="1/2" mb="1" />
          <Skeleton h="3" w="2/3" mb="1" />
          <Skeleton h="3" w="1/3" />
        </Box>
      ))}
    </SimpleGrid>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <Box display="flex" flexDirection="column" gap="2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} h="14" borderRadius="lg" />
      ))}
    </Box>
  );
}
