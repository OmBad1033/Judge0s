import { Box, Button, HStack, SimpleGrid, Text } from '@chakra-ui/react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { DefaultQuestionDto } from '../types';

interface Props {
  question: DefaultQuestionDto;
  value: string;
  onChange: (value: string) => void;
}

// Controlled input-only — saved with the slide feedback via the parent's
// single submit.
export default function DefaultQuestionForm({ question, value, onChange }: Props) {
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" overflow="hidden">
      <Box px="4" py="3" borderBottomWidth="1px" borderColor="border.subtle">
        <Text fontWeight="semibold">{question.questionText}</Text>
      </Box>

      {question.questionType === 'interested' && (
        <SimpleGrid columns={2} gap="2" p="3">
          {[
            { v: 'interested', label: 'Interested', icon: <ThumbsUp size={18} /> },
            { v: 'not_interested', label: 'Not Interested', icon: <ThumbsDown size={18} /> },
          ].map((opt) => {
            const selected = value === opt.v;
            return (
              <Button
                key={opt.v}
                onClick={() => onChange(opt.v)}
                variant={selected ? 'solid' : 'outline'}
                colorPalette={selected ? 'green' : undefined}
                justifyContent="center"
                h="12"
                textTransform="uppercase"
                letterSpacing="wide"
                fontSize="xs"
              >
                {opt.icon}
                {opt.label}
              </Button>
            );
          })}
        </SimpleGrid>
      )}

      {question.questionType === 'rating' && (
        <Box p="3">
          <HStack gap="1" justify="space-between">
            {Array.from({ length: 11 }, (_, n) => {
              const selected = value === String(n);
              return (
                <Button
                  key={n}
                  onClick={() => onChange(String(n))}
                  variant={selected ? 'solid' : 'ghost'}
                  colorPalette={selected ? 'green' : undefined}
                  size="sm"
                  minW="9"
                  flex="1"
                  px="0"
                  fontFamily="mono"
                >
                  {n}
                </Button>
              );
            })}
          </HStack>
          <HStack justify="space-between" mt="2">
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
              0 — Low
            </Text>
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
              10 — High
            </Text>
          </HStack>
        </Box>
      )}
    </Box>
  );
}
