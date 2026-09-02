import { Box, Flex, Heading, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <Flex
      direction={{ base: 'column', md: 'row' }}
      align={{ base: 'stretch', md: 'flex-end' }}
      justify="space-between"
      gap="4"
      pb="4"
      mb="6"
      borderBottomWidth="1px"
      borderColor="border.subtle"
    >
      <Box minW="0">
        {eyebrow && (
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" fontWeight="medium" mb="1">
            {eyebrow}
          </Text>
        )}
        <Heading size="lg" fontWeight="bold" letterSpacing="tight" textTransform="uppercase" truncate>
          {title}
        </Heading>
        {description && (
          <Text color="fg.muted" fontSize="sm" mt="1">
            {description}
          </Text>
        )}
      </Box>
      {actions && (
        <Flex gap="2" flexShrink="0">
          {actions}
        </Flex>
      )}
    </Flex>
  );
}
