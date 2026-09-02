import { useState } from 'react';
import {
  Box,
  Button,
  Field,
  FieldLabel,
  Grid,
  HStack,
  Icon,
  Separator,
  Tag,
  Text,
  Textarea,
  VStack,
  Spinner,
} from '@chakra-ui/react';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Layers,
  MessageSquarePlus,
  Sparkles,
  X,
} from 'lucide-react';
import type { AiSlideSuggestion } from '../types';
import { api, ApiError } from '../api';

interface AISuggestionPanelProps {
  presentationId: string;
  suggestion: AiSlideSuggestion | undefined;
  /** True when the deck already has suggestions generated (for other slides). */
  hasGenerated: boolean;
  /** Busy flags so the per-slide and whole-deck buttons disable independently. */
  slideBusy: boolean;
  allBusy: boolean;
  onGenerateSlide: () => void;
  onGenerateAll: () => void;
  onRefresh: () => void;
  onApprove: (s: AiSlideSuggestion, overrides?: { title?: string; summary?: string; comment?: string }) => void;
  onReject: (s: AiSlideSuggestion, comment?: string) => void;
  toast: {
    push: (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void;
  };
}

const FIELD_LABELS: Record<string, string> = {
  boolean: 'Yes / No',
  single_select: 'Single choice',
  multi_select: 'Multiple choice',
  rating: 'Rating',
  nps: 'NPS',
  text: 'Short text',
  textarea: 'Open text',
};

/**
 * Panel shown at the bottom of the slide form. Two generation actions:
 *   - "Generate for this slide" — one slide only
 *   - "Generate for all slides" — the whole deck
 * When a suggestion exists for the active slide it also offers Approve /
 * Reject / "suggest changes" (revise via the model).
 */
export default function AISuggestionPanel({
  presentationId,
  suggestion,
  hasGenerated,
  slideBusy,
  allBusy,
  onGenerateSlide,
  onGenerateAll,
  onRefresh,
  onApprove,
  onReject,
  toast,
}: AISuggestionPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [reviseBusy, setReviseBusy] = useState(false);

  const busy = slideBusy || allBusy;

  const renderGenerateActions = (regeneratingThisSlide: boolean) => (
    <HStack gap="2" flexWrap="wrap">
      <Button
        colorPalette="green"
        size="sm"
        onClick={onGenerateSlide}
        disabled={busy}
      >
        {slideBusy ? <Spinner size="sm" /> : <Sparkles size={15} />}
        {slideBusy
          ? 'Generating…'
          : regeneratingThisSlide
            ? 'Regenerate this slide'
            : 'Generate for this slide'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onGenerateAll}
        disabled={busy}
      >
        {allBusy ? <Spinner size="sm" /> : <Layers size={15} />}
        {allBusy ? 'Generating…' : hasGenerated ? 'Regenerate all slides' : 'Generate for all slides'}
      </Button>
    </HStack>
  );

  if (!suggestion) {
    // No pending suggestion for the active slide.
    return (
      <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="5">
        <HStack gap="2" mb="3">
          <Icon color="green.solid"><Bot size={18} /></Icon>
          <Box>
            <Text fontSize="sm" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide">
              AI Slide Suggestions
            </Text>
            <Text color="fg.muted" fontSize="xs">
              {hasGenerated
                ? 'No pending suggestion for this slide — generate one just for it, or regenerate the whole deck below.'
                : 'Auto-propose a title, summary, and feedback questions from the uploaded deck.'}
            </Text>
          </Box>
        </HStack>
        {renderGenerateActions(false)}
      </Box>
    );
  }

  const s = suggestion;

  return (
    <Box borderWidth="1px" borderColor="green.emphasized" borderRadius="lg" bg="bg.surface" p="5">
      <HStack justify="space-between" gap="3" cursor="pointer" onClick={() => setExpanded((e) => !e)}>
        <HStack gap="2">
          <Icon color="green.solid"><Bot size={18} /></Icon>
          <Text fontSize="sm" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide">
            AI Suggestion — Slide {String(s.slideNumber).padStart(2, '0')}
          </Text>
          {s.status !== 'pending' && (
            <Tag.Root size="sm" colorPalette={s.status === 'approved' ? 'green' : 'red'} variant="subtle" textTransform="uppercase" fontSize="xs">
              {s.status === 'approved' ? 'Approved' : 'Rejected'}
            </Tag.Root>
          )}
        </HStack>
        <Icon color="fg.muted">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</Icon>
      </HStack>

      {expanded && (
        <VStack gap="4" align="stretch" mt="4">
          {s.suggestedTitle && (
            <Box>
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="1">
                Proposed Title
              </Text>
              <Text fontWeight="medium">{s.suggestedTitle}</Text>
            </Box>
          )}

          <Box>
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="1">
              Proposed Summary
            </Text>
            <Text fontSize="sm" lineHeight="relaxed">
              {s.suggestedSummary || '—'}
            </Text>
          </Box>

          {s.fields.length > 0 && (
            <Box>
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="1">
                Proposed Feedback
              </Text>
              <VStack gap="1.5" align="stretch">
                {s.fields.map((f) => (
                  <Grid
                    key={f.id}
                    gridTemplateColumns="70% 30%"
                    alignItems="center"
                    gap="3"
                    p="2"
                    bg="bg.muted"
                    borderRadius="md"
                    borderWidth="1px"
                    borderColor="border.subtle"
                  >
                    <Text fontSize="sm" fontWeight="medium" minW="0">
                      {f.label}
                    </Text>
                    <HStack gap="1.5" justifySelf="end" flexWrap="wrap" justify="flex-end">
                      <Tag.Root size="sm" variant="subtle" textTransform="uppercase" fontSize="xs">
                        {FIELD_LABELS[f.fieldType] ?? f.fieldType}
                      </Tag.Root>
                      {f.isRequired && (
                        <Tag.Root size="sm" colorPalette="orange" variant="subtle" textTransform="uppercase" fontSize="xs">
                          Required
                        </Tag.Root>
                      )}
                    </HStack>
                  </Grid>
                ))}
              </VStack>
            </Box>
          )}

          <Separator borderColor="border.subtle" />

          {/* Review actions */}
          <HStack gap="2" flexWrap="wrap">
            <Button
              colorPalette="green"
              size="sm"
              onClick={() => {
                onApprove(s);
                setExpanded(false);
              }}
            >
              <Check size={15} />
              Approve &amp; Apply
            </Button>
            <Button
              variant="outline"
              size="sm"
              colorPalette="red"
              onClick={() => {
                onReject(s);
                setExpanded(false);
              }}
            >
              <X size={15} />
              Reject
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCommentOpen((o) => !o)}
            >
              <MessageSquarePlus size={15} />
              Suggest changes
            </Button>
          </HStack>

          {commentOpen && (
            <VStack gap="2" align="stretch" mt="1">
              <Field.Root>
                <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                  What should change?
                </FieldLabel>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="e.g. Make the summary shorter and mention the ROI figure; add a multiple-choice question about clarity."
                  minH="70px"
                  resize="none"
                  size="sm"
                />
              </Field.Root>
              <HStack gap="2">
                <Button
                  colorPalette="green"
                  size="sm"
                  loading={reviseBusy}
                  disabled={!comment.trim()}
                  onClick={async () => {
                    setReviseBusy(true);
                    try {
                      await api.aiRevise(presentationId, s.slideId!, comment.trim());
                      onRefresh();
                      setComment('');
                      setCommentOpen(false);
                      toast.push('success', 'Revised suggestion ready');
                    } catch (e) {
                      toast.push('error', e instanceof ApiError ? e.message : 'Revision failed');
                    } finally {
                      setReviseBusy(false);
                    }
                  }}
                >
                  {!reviseBusy && <CornerDownLeft size={15} />}
                  {reviseBusy ? 'Revising…' : 'Revise with my comments'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCommentOpen(false)}>
                  Cancel
                </Button>
              </HStack>
            </VStack>
          )}

          <Separator borderColor="border.subtle" />

          {/* Regenerate actions */}
          {renderGenerateActions(true)}
        </VStack>
      )}
    </Box>
  );
}
