import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError, type PutSlideBody } from '../../api';
import type {
  Presentation,
  FeedbackType,
  SlideEventRule,
  DefaultQuestion,
  DefaultQuestionType,
} from '../../types';
import { useToast } from '../../lib/toast';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Flex,
  Grid,
  Heading,
  HStack,
  Icon,
  Input,
  RadioGroup,
  Separator,
  SimpleGrid,
  Tag,
  Text,
  Textarea,
  VStack,
} from '@chakra-ui/react';
import { Check, CheckCircle2, FilePen, Plus, Radar, Save, Star, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/page-header';
import { SkeletonRows } from '../../components/ui/skeleton';
import ConnectionStatus from '../../components/ConnectionStatus';
import FeedbackForm from '../../components/FeedbackForm';
import DefaultQuestionForm from '../../components/DefaultQuestionForm';

const TYPES: { value: FeedbackType; label: string; icon: React.ReactNode }[] = [
  { value: 'disabled', label: 'None', icon: <BlockIcon /> },
  { value: 'boolean', label: 'Yes / No', icon: <ToggleIcon /> },
  { value: 'multiple_choice', label: 'Choice', icon: <ChecklistIcon /> },
  { value: 'open_text', label: 'Text', icon: <ChatIcon /> },
];

interface Draft {
  title: string;
  summary: string;
  enabled: boolean;
  required: boolean;
  type: FeedbackType;
  question: string;
  options: string[];
  allowResubmission: boolean;
  saved: boolean;
  dirty: boolean;
}

export default function ConfigureSlides() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState(0);
  const [defaultQuestions, setDefaultQuestions] = useState<DefaultQuestion[]>([]);
  const [dqText, setDqText] = useState('');
  const [dqType, setDqType] = useState<DefaultQuestionType>('interested');
  const [dqAll, setDqAll] = useState(true);
  const [dqSelected, setDqSelected] = useState<number[]>([]);
  const [dqBusy, setDqBusy] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [sessionName, setSessionName] = useState('');

  const loadDefaultQuestions = () => {
    if (!id) return;
    api.listDefaultQuestions(id).then((r) => setDefaultQuestions(r.defaultQuestions)).catch(() => {});
  };
  useEffect(loadDefaultQuestions, [id]);

  useEffect(() => {
    if (!id) return;
    api.listSlides(id).then(({ presentation, slides }) => {
      setPresentation(presentation);
      const byNum = new Map(slides.map((s) => [s.slideNumber, s]));
      setDrafts(
        Array.from({ length: presentation.slideCount }, (_, i) => {
          const s = byNum.get(i + 1);
          const r = s?.feedbackRule;
          return {
            title: s?.title ?? '',
            summary: s?.summary ?? '',
            enabled: r?.enabled ?? false,
            required: r?.required ?? false,
            type: r?.feedbackType ?? 'disabled',
            question: r?.question ?? '',
            options: r?.options ?? [],
            allowResubmission: r?.allowResubmission ?? false,
            saved: !!s,
            dirty: false,
          };
        }),
      );
    });
  }, [id]);

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((dr, idx) => (idx === i ? { ...dr, ...patch, dirty: true } : dr)));

  const save = async (i: number) => {
    const d = drafts[i];
    if (!id) return;
    const body: PutSlideBody = {
      title: d.title || undefined,
      summary: d.summary,
      feedbackRule: {
        enabled: d.enabled,
        required: d.required,
        feedbackType: d.type,
        question: d.question || undefined,
        options: d.type === 'multiple_choice' ? d.options.map((o) => o.trim()).filter(Boolean) : undefined,
        allowResubmission: d.allowResubmission,
      },
    };
    try {
      await api.putSlide(id, i + 1, body);
      update(i, { saved: true, dirty: false });
      toast.push('success', `Slide ${i + 1} saved`);
    } catch (e) {
      toast.push('error', e instanceof ApiError ? e.message : 'Save failed');
    }
  };

  const createSession = async () => {
    if (!id) return;
    try {
      const s = await api.createSession(id, sessionName.trim() || undefined);
      setShowNamePrompt(false);
      setSessionName('');
      toast.push('success', 'Session created');
      navigate(`/admin/sessions/${s.sessionCode}`);
    } catch (e) {
      toast.push('error', e instanceof ApiError ? e.message : 'Failed to create session');
    }
  };

  const targetSlides = dqAll ? Array.from({ length: presentation?.slideCount ?? 0 }, (_, i) => i + 1) : dqSelected;

  const addDefaultQuestion = async () => {
    if (!id || !dqText.trim()) return;
    if (!dqAll && dqSelected.length === 0) {
      toast.push('warning', 'Select at least one slide for the default question.');
      return;
    }
    setDqBusy(true);
    try {
      await api.createDefaultQuestion(id, { questionText: dqText.trim(), questionType: dqType, targetSlides });
      setDqText('');
      setDqSelected([]);
      loadDefaultQuestions();
      toast.push('success', 'Default question added');
    } catch (e) {
      toast.push('error', e instanceof ApiError ? e.message : 'Failed to add default question');
    } finally {
      setDqBusy(false);
    }
  };

  const removeDefaultQuestion = async (qid: string) => {
    if (!id) return;
    try {
      await api.deleteDefaultQuestion(id, qid);
      loadDefaultQuestions();
      toast.push('info', 'Default question removed');
    } catch (e) {
      toast.push('error', e instanceof ApiError ? e.message : 'Failed to remove');
    }
  };

  const toggleSlide = (n: number) =>
    setDqSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n].sort((a, b) => a - b)));

  if (!presentation) {
    return <SkeletonRows rows={4} />;
  }

  const d = drafts[active];

  const previewRule: SlideEventRule = {
    enabled: d.enabled && d.type !== 'disabled',
    required: d.required,
    type: d.type,
    question: d.question || null,
    options: d.type === 'multiple_choice' ? d.options : null,
    allowResubmission: d.allowResubmission,
  };

  const previewDefaultQuestions = defaultQuestions.filter((q) => q.targetSlides.includes(active + 1));

  return (
    <VStack gap="4" align="stretch">
      <PageHeader
        eyebrow="Slide Configuration"
        title={presentation.title}
        description={`${presentation.slideCount} Slides · Configure content and feedback`}
        actions={
          <Button colorPalette="green" onClick={() => setShowNamePrompt(true)}>
            <Radar size={16} />
            Create Session
          </Button>
        }
      />

      <Grid templateColumns={{ base: '1fr', lg: '3fr 5fr 4fr' }} gap="4" alignItems="start">
        {/* LEFT — slide list */}
        <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="3" position={{ lg: 'sticky' }} top={{ lg: '16' }}>
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="2" px="1">
            Slides
          </Text>
          <VStack gap="1" align="stretch">
            {drafts.map((dr, i) => {
              const isActive = active === i;
              return (
                <Button
                  key={i}
                  onClick={() => setActive(i)}
                  variant={isActive ? 'surface' : 'ghost'}
                  colorPalette={isActive ? 'green' : undefined}
                  justifyContent="flex-start"
                  h="10"
                  px="2"
                  gap="2.5"
                  borderRadius="md"
                  _active={{ bg: undefined }}
                >
                  <Box
                    w="6"
                    h="6"
                    borderRadius="sm"
                    display="grid"
                    placeItems="center"
                    fontSize="xs"
                    fontFamily="mono"
                    bg={isActive ? 'green.solid' : 'bg.muted'}
                    color={isActive ? 'green.fg' : 'fg.muted'}
                    flexShrink="0"
                  >
                    {isActive ? '>' : String(i + 1).padStart(2, '0')}
                  </Box>
                  <Text fontSize="sm" truncate flex="1" textAlign="left">
                    {dr.title || `Untitled ${String(i + 1).padStart(2, '0')}`}
                  </Text>
                  {dr.dirty ? (
                    <FilePen size={14} color="var(--chakra-colors-orange-solid)" />
                  ) : dr.saved ? (
                    <CheckCircle2 size={14} color="var(--chakra-colors-green-solid)" />
                  ) : null}
                </Button>
              );
            })}
          </VStack>
        </Box>

        {/* MIDDLE — editor */}
        <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="5">
          <HStack gap="2" mb="4" pb="3" borderBottomWidth="1px" borderColor="border.subtle">
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
              Slide
            </Text>
            <Heading size="md" fontFamily="mono">
              {String(active + 1).padStart(2, '0')}
            </Heading>
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
              / {String(presentation.slideCount).padStart(2, '0')}
            </Text>
          </HStack>

          <VStack gap="4" align="stretch">
            <Field.Root>
              <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                Title (Optional)
              </FieldLabel>
              <Input
                value={d.title}
                onChange={(e) => update(active, { title: e.target.value })}
                placeholder="Slide title"
                size="lg"
              />
            </Field.Root>

            <Field.Root>
              <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                Summary
              </FieldLabel>
              <Textarea
                value={d.summary}
                onChange={(e) => update(active, { summary: e.target.value })}
                placeholder="What participants see for this slide"
                minH="80px"
                resize="none"
                size="lg"
              />
            </Field.Root>

            <Box>
              <Text fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted" mb="2">
                Input Modality
              </Text>
              <SimpleGrid columns={{ base: 2, sm: 4 }} gap="2">
                {TYPES.map((t) => {
                  const selected = d.type === t.value;
                  return (
                    <Button
                      key={t.value}
                      onClick={() => update(active, { type: t.value, enabled: t.value !== 'disabled' })}
                      variant={selected ? 'solid' : 'outline'}
                      colorPalette={selected ? 'green' : undefined}
                      flexDirection="column"
                      gap="1"
                      h="56px"
                      textTransform="uppercase"
                      letterSpacing="wide"
                      fontSize="xs"
                    >
                      <Icon boxSize="4">{t.icon}</Icon>
                      {t.label}
                    </Button>
                  );
                })}
              </SimpleGrid>
            </Box>

            {d.type !== 'disabled' && (
              <>
                <Field.Root>
                  <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                    Prompt Text
                  </FieldLabel>
                  <Input
                    value={d.question}
                    onChange={(e) => update(active, { question: e.target.value })}
                    placeholder="Ask participants something"
                    size="lg"
                  />
                </Field.Root>

                {d.type === 'multiple_choice' && (
                  <Field.Root>
                    <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                      Options
                    </FieldLabel>
                    <Textarea
                      value={d.options.join('\n')}
                      onChange={(e) => update(active, { options: e.target.value.split('\n') })}
                      placeholder={'Highly Accurate\nPartially Accurate\nInaccurate'}
                      minH="100px"
                      resize="none"
                      size="lg"
                    />
                  </Field.Root>
                )}

                <HStack gap="6">
                  <Checkbox.Root
                    checked={d.required}
                    onCheckedChange={(e) => update(active, { required: !!e.checked })}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Checkbox.Label fontSize="sm">Required</Checkbox.Label>
                  </Checkbox.Root>
                  <Checkbox.Root
                    checked={d.allowResubmission}
                    onCheckedChange={(e) => update(active, { allowResubmission: !!e.checked })}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Checkbox.Label fontSize="sm">Allow Resubmission</Checkbox.Label>
                  </Checkbox.Root>
                </HStack>
              </>
            )}

            <HStack gap="3" pt="3" mt="2" borderTopWidth="1px" borderColor="border.subtle">
              <Button colorPalette="green" onClick={() => save(active)}>
                <Save size={16} />
                Save Slide
              </Button>
              {d.dirty ? (
                <HStack gap="1.5" color="orange.solid" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                  <FilePen size={14} />
                  Unsaved Changes
                </HStack>
              ) : d.saved ? (
                <HStack gap="1.5" color="green.solid" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                  <Check size={14} />
                  Saved
                </HStack>
              ) : null}
            </HStack>
          </VStack>
        </Box>

        {/* RIGHT — phone-shaped live preview */}
        <Box>
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="2" px="1">
            Preview — Mobile
          </Text>
          <Box bg="bg.muted" borderWidth="1px" borderColor="border.subtle" borderRadius="lg" p="6" display="flex" justifyContent="center">
            <Box
              w="320px"
              maxW="full"
              borderRadius="24px"
              borderWidth="1px"
              borderColor="border.emphasized"
              bg="bg.surface"
              overflow="hidden"
              boxShadow="lg"
            >
              {/* Notch */}
              <Flex justify="center" pt="2">
                <Box w="16" h="1" bg="border.emphasized" borderRadius="full" />
              </Flex>

              <Box maxH="560px" overflowY="auto" p="4" display="flex" flexDirection="column" gap="4" pb="20">
                <Flex align="center" justify="space-between" borderWidth="1px" borderColor="border.subtle" borderRadius="lg" px="3" py="2">
                  <Text color="fg.muted" fontSize="xs" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
                    Session: ---- 
                  </Text>
                  <ConnectionStatus state="connected" />
                </Flex>

                <Flex align="center" justify="space-between" borderWidth="1px" borderColor="border.subtle" borderRadius="lg" px="3" py="2">
                  <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                    Active Slide
                  </Text>
                  <Text fontFamily="mono" fontSize="2xl" fontWeight="bold">
                    {String(active + 1).padStart(2, '0')}
                  </Text>
                </Flex>

                <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface">
                  <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" px="4" py="2" borderBottomWidth="1px" borderColor="border.subtle">
                    Query Data
                  </Text>
                  <Box p="4">
                    {d.title || d.summary ? (
                      <>
                        {d.title && (
                          <Heading size="sm" mb="1" textTransform="uppercase" letterSpacing="tight">
                            {d.title}
                          </Heading>
                        )}
                        {d.summary && (
                          <Text color="fg.muted" fontSize="sm" lineHeight="relaxed">
                            {d.summary}
                          </Text>
                        )}
                      </>
                    ) : (
                      <VStack py="4" gap="1" textAlign="center">
                        <Icon color="fg.muted" boxSize="6">
                          <EyeOffIcon />
                        </Icon>
                        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                          No content
                        </Text>
                      </VStack>
                    )}
                  </Box>
                </Box>

                {previewRule.enabled ? (
                  <FeedbackForm rule={previewRule} value="" onChange={() => {}} />
                ) : (
                  <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" p="6" textAlign="center">
                    <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                      Feedback is disabled for this slide.
                    </Text>
                  </Box>
                )}

                {previewDefaultQuestions.map((q) => (
                  <DefaultQuestionForm key={q.id} question={q} value="" onChange={() => {}} />
                ))}
              </Box>

              {/* Bottom submit bar */}
              <Box px="4" pt="3" pb="12px" borderTopWidth="1px" borderColor="border.subtle" bg="bg.panel">
                <Button colorPalette="green" w="full" size="lg" disabled>
                  Submit Response
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      </Grid>

      {/* Default questions */}
      <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" mt="2">
        <Box px="5" py="4" borderBottomWidth="1px" borderColor="border.subtle">
          <HStack gap="2">
            <Star size={18} color="var(--chakra-colors-green-solid)" />
            <Box>
              <Heading size="sm" textTransform="uppercase" letterSpacing="wide">
                Default Questions
              </Heading>
              <Text color="fg.muted" fontSize="sm" mt="1">
                Generic questions shown on the selected slides in addition to each slide&apos;s own feedback.
              </Text>
            </Box>
          </HStack>
        </Box>

        <VStack gap="4" align="stretch" p="5">
          <Field.Root>
            <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
              Question Text
            </FieldLabel>
            <Input
              value={dqText}
              onChange={(e) => setDqText(e.target.value)}
              placeholder={dqType === 'interested' ? 'Are you interested in this?' : 'Rate this slide'}
              size="lg"
            />
          </Field.Root>

          <RadioGroup.Root
            value={dqType}
            onValueChange={(e) => setDqType(e.value as DefaultQuestionType)}
            colorPalette="green"
          >
            <HStack gap="6">
              <RadioGroup.Item value="interested">
                <RadioGroup.ItemControl />
                <RadioGroup.ItemText fontSize="sm">Interested / Not Interested</RadioGroup.ItemText>
              </RadioGroup.Item>
              <RadioGroup.Item value="rating">
                <RadioGroup.ItemControl />
                <RadioGroup.ItemText fontSize="sm">0 — 10 Rating</RadioGroup.ItemText>
              </RadioGroup.Item>
            </HStack>
          </RadioGroup.Root>

          <Box>
            <Flex align="center" justify="space-between" mb="2">
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                Apply To
              </Text>
              <Checkbox.Root checked={dqAll} onCheckedChange={(e) => setDqAll(!!e.checked)}>
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label fontSize="xs">All Slides</Checkbox.Label>
              </Checkbox.Root>
            </Flex>
            {!dqAll && (
              <Flex gap="1" flexWrap="wrap">
                {Array.from({ length: presentation.slideCount }, (_, i) => i + 1).map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={dqSelected.includes(n) ? 'solid' : 'outline'}
                    colorPalette={dqSelected.includes(n) ? 'green' : undefined}
                    minW="9"
                    onClick={() => toggleSlide(n)}
                    fontFamily="mono"
                  >
                    {String(n).padStart(2, '0')}
                  </Button>
                ))}
              </Flex>
            )}
          </Box>

          <Button
            colorPalette="green"
            w="fit-content"
            onClick={addDefaultQuestion}
            disabled={dqBusy || !dqText.trim()}
          >
            <Plus size={16} />
            {dqBusy ? 'Adding…' : 'Add Default Question'}
          </Button>
        </VStack>

        {defaultQuestions.length > 0 && (
          <Box borderTopWidth="1px" borderColor="border.subtle" px="5" py="4" display="flex" flexDirection="column" gap="2">
            {defaultQuestions.map((q) => (
              <Flex
                key={q.id}
                align="center"
                justify="space-between"
                gap="3"
                p="3"
                bg="bg.muted"
                borderRadius="lg"
                borderWidth="1px"
                borderColor="border.subtle"
              >
                <Box minW="0">
                  <Text fontWeight="medium" truncate>
                    {q.questionText}
                  </Text>
                  <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mt="0.5">
                    {q.questionType === 'interested' ? 'Interested / Not Interested' : '0–10 Rating'} · Slides{' '}
                    {q.targetSlides.length === presentation.slideCount ? 'all' : q.targetSlides.join(', ')}
                  </Text>
                </Box>
                <Button variant="ghost" colorPalette="red" size="sm" onClick={() => removeDefaultQuestion(q.id)} aria-label="Remove">
                  <Trash2 size={16} />
                </Button>
              </Flex>
            ))}
          </Box>
        )}
      </Box>

      {/* Session name dialog */}
      <Dialog.Root open={showNamePrompt} onOpenChange={(e) => e.open === false && setShowNamePrompt(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name this session?</DialogTitle>
            <DialogCloseTrigger />
          </DialogHeader>
          <DialogBody>
            <VStack as="form" gap="4" align="stretch" onSubmit={(e) => { e.preventDefault(); createSession(); }}>
              <Field.Root>
                <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                  Session Name
                </FieldLabel>
                <Input
                  autoFocus
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Q3 Board Review"
                  size="lg"
                />
              </Field.Root>
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                Leave blank — we&apos;ll use the session code.
              </Text>
              <HStack justify="flex-end" gap="2">
                <Button variant="outline" onClick={() => setShowNamePrompt(false)}>
                  Cancel
                </Button>
                <Button type="submit" colorPalette="green">
                  Create Session
                </Button>
              </HStack>
            </VStack>
          </DialogBody>
        </DialogContent>
      </Dialog.Root>
    </VStack>
  );
}

function BlockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m9 9 6 6" />
      <path d="m15 9-6 6" />
    </svg>
  );
}

function ToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="5" width="22" height="14" rx="7" />
      <circle cx="16" cy="12" r="3" />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}
