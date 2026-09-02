import { Box, Button, Text, Textarea, VStack } from '@chakra-ui/react';
import type { SlideEventRule } from '../types';

interface Props {
  rule: SlideEventRule;
  value: string;
  onChange: (value: string) => void;
}

// Controlled input-only — submit is handled by the parent (single submit
// saves slide feedback + default answers together).
export default function FeedbackForm({ rule, value, onChange }: Props) {
  if (!rule.enabled || rule.type === 'disabled') return null;

  const options =
    rule.type === 'boolean' ? ['yes', 'no'] : rule.type === 'multiple_choice' ? (rule.options ?? []) : [];

  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" overflow="hidden">
      {rule.question && (
        <Box px="4" py="3" borderBottomWidth="1px" borderColor="border.subtle">
          <Text fontWeight="semibold">{rule.question}</Text>
        </Box>
      )}

      {(rule.type === 'boolean' || rule.type === 'multiple_choice') && (
        <VStack gap="2" p="3" align="stretch">
          {options.map((opt, i) => {
            const selected = value === opt;
            const label = String.fromCharCode(65 + i);
            return (
              <Button
                key={opt}
                type="button"
                onClick={() => onChange(opt)}
                variant={selected ? 'solid' : 'outline'}
                colorPalette={selected ? 'green' : undefined}
                justifyContent="flex-start"
                h="auto"
                minH="12"
                px="4"
                py="3"
                textAlign="left"
                borderColor={selected ? 'green.solid' : 'border.subtle'}
                borderRadius="md"
              >
                <Box display="flex" alignItems="center" gap="3" w="full">
                  <Text
                    color={selected ? 'green.fg' : 'fg.muted'}
                    fontSize="xs"
                    fontFamily="mono"
                    textTransform="uppercase"
                    letterSpacing="wider"
                    w="5"
                    flexShrink="0"
                  >
                    {label}.
                  </Text>
                  <Text fontWeight="medium" textTransform="capitalize">
                    {opt}
                  </Text>
                </Box>
              </Button>
            );
          })}
        </VStack>
      )}

      {rule.type === 'open_text' && (
        <Box p="3" position="relative">
          <Textarea
            value={value}
            maxLength={2000}
            placeholder="Type your response…"
            minH="120px"
            resize="none"
            onChange={(e) => onChange(e.target.value)}
          />
          <Text position="absolute" bottom="5" right="5" color="fg.muted" fontSize="xs" fontFamily="mono" bg="bg.surface" px="1.5" py="0.5" borderRadius="sm">
            {value.length} / 2000
          </Text>
        </Box>
      )}
    </Box>
  );
}
