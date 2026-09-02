import { Box, RadioCard, RadioCardItem, RadioCardLabel, Text, Textarea, VStack } from '@chakra-ui/react';
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
        <RadioCard.Root
          size="md"
          variant="outline"
          value={value}
          onValueChange={(e) => onChange(e.value ?? '')}
          gap="2"
          p="3"
        >
          {options.map((opt, i) => {
            const selected = value === opt;
            const label = String.fromCharCode(65 + i);
            return (
              <RadioCardItem
                key={opt}
                value={opt}
                borderColor={selected ? 'green.solid' : 'border.subtle'}
                _checked={{ borderColor: 'green.solid', bg: 'green.solid/5' }}
              >
                <RadioCardLabel flex="1">
                  <Box display="flex" alignItems="center" gap="3">
                    <Text
                      color={selected ? 'green.solid' : 'fg.muted'}
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
                </RadioCardLabel>
              </RadioCardItem>
            );
          })}
        </RadioCard.Root>
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
