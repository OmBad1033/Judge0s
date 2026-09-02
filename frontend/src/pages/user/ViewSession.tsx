import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { usePresentationSocket } from '../../usePresentationSocket';
import type {
  SlideEvent,
  SlideEventRule,
  StoredResponse,
  StoredDefaultResponse,
  ParticipantState,
  ConnectionState,
} from '../../types';
import {
  Alert,
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from '@chakra-ui/react';
import { CheckCircle2, Hourglass, Send, StopCircle, WifiOff } from 'lucide-react';
import FeedbackForm from '../../components/FeedbackForm';
import DefaultQuestionForm from '../../components/DefaultQuestionForm';
import ConnectionStatus from '../../components/ConnectionStatus';

const ERR_MSG: Record<string, string> = {
  RESUBMISSION_NOT_ALLOWED: "You can't change your response for this slide.",
  RESPONSE_REQUIRED: 'A response is required.',
  INVALID_BOOLEAN: 'Please choose Yes or No.',
  INVALID_CHOICE: 'Please pick one of the options.',
  INVALID_RATING: 'Rating must be a whole number from 0 to 10.',
  RESPONSE_TOO_LONG: 'Response is too long (max 2000 chars).',
  FEEDBACK_DISABLED: 'Feedback is disabled for this slide.',
  SLIDE_OUT_OF_RANGE: 'This question is not active on the current slide.',
};

const mapErr = (e: unknown) => {
  const c = e instanceof ApiError ? e.message : 'Submission failed';
  return ERR_MSG[c] ?? c;
};

export default function ViewSession() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [pid, setPid] = useState<string | null>(null);
  const [boot, setBoot] = useState<ParticipantState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [responses, setResponses] = useState<StoredResponse[]>([]);
  const [defaultResponses, setDefaultResponses] = useState<StoredDefaultResponse[]>([]);
  const { event: wsEvent, connected } = usePresentationSocket(code);

  const [slideValue, setSlideValue] = useState('');
  const [defaultValues, setDefaultValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: 'idle' | 'ok' | 'error' | 'submitting'; message?: string }>({
    kind: 'idle',
  });

  const bootstrap = useCallback(async () => {
    if (!code) return;
    const stored = localStorage.getItem('participant');
    if (!stored) {
      navigate(`/join/${encodeURIComponent(code)}`);
      return;
    }
    let p: { participantId: string; code: string };
    try {
      p = JSON.parse(stored);
    } catch {
      navigate(`/join/${encodeURIComponent(code)}`);
      return;
    }
    if (p.code !== code) {
      navigate(`/join/${encodeURIComponent(code)}`);
      return;
    }
    setPid(p.participantId);
    try {
      const state = await api.participantState(code, p.participantId);
      setBoot(state);
      setResponses(state.responses);
      setDefaultResponses(state.defaultResponses);
      setBootError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) navigate(`/join/${encodeURIComponent(code)}`);
      else setBootError(mapErr(e));
    }
  }, [code, navigate]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const event: SlideEvent | null = wsEvent ?? boot?.event ?? null;
  const sessionStatus = boot?.session.status ?? null;
  const slideNumber = event?.type === 'SLIDE_CHANGED' ? event.slideNumber : boot?.session.currentSlideNumber ?? null;
  const rule: SlideEventRule | null = event?.type === 'SLIDE_CHANGED' ? (event.feedbackRule ?? null) : null;
  const defaultQuestions = event?.type === 'SLIDE_CHANGED' ? (event.defaultQuestions ?? []) : [];
  const existing = slideNumber != null ? (responses.find((r) => r.slideNumber === slideNumber) ?? null) : null;
  const locked = !!existing && !(rule?.allowResubmission ?? false);

  useEffect(() => {
    if (slideNumber == null) return;
    const ex = responses.find((r) => r.slideNumber === slideNumber);
    setSlideValue(ex?.responseValue ?? '');
    const dvs: Record<string, string> = {};
    for (const dq of defaultQuestions) {
      const dr = defaultResponses.find((r) => r.defaultQuestionId === dq.id && r.slideNumber === slideNumber);
      dvs[dq.id] = dr?.responseValue ?? '';
    }
    setDefaultValues(dvs);
    setStatus({ kind: 'idle' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideNumber, event]);

  const ended = event?.type === 'SESSION_ENDED' || sessionStatus === 'ended';
  const waiting = event?.type === 'NO_ACTIVE_SLIDE';
  const active = event?.type === 'SLIDE_CHANGED';
  const hasContent = !!(active && (event!.slide?.title || event!.slide?.summary));
  const slideSubmittable = !!rule?.enabled && rule.type !== 'disabled' && !locked;
  const canSubmit = slideSubmittable || defaultQuestions.length > 0;

  const submitAll = async () => {
    if (!code || !pid || slideNumber == null) return;
    setStatus({ kind: 'submitting' });
    const errs: string[] = [];

    if (slideSubmittable) {
      try {
        const res = await api.submitFeedback(code, pid, slideNumber, slideValue);
        setResponses((rs) =>
          [...rs.filter((r) => r.slideNumber !== slideNumber), res].sort((a, b) => a.slideNumber - b.slideNumber),
        );
      } catch (e) {
        errs.push(mapErr(e));
      }
    }

    for (const dq of defaultQuestions) {
      const v = defaultValues[dq.id];
      if (!v) continue;
      try {
        const res = await api.submitDefaultFeedback(code, pid, dq.id, slideNumber, v);
        setDefaultResponses((rs) => [
          ...rs.filter((r) => !(r.defaultQuestionId === dq.id && r.slideNumber === slideNumber)),
          res,
        ]);
      } catch (e) {
        errs.push(mapErr(e));
      }
    }

    if (errs.length) {
      setStatus({ kind: 'error', message: errs[0] });
    } else {
      setStatus({ kind: 'ok', message: 'Responses saved' });
    }
  };

  const connectionState: ConnectionState = ended ? 'ended' : connected ? 'connected' : 'reconnecting';

  if (!event && !bootError) {
    return (
      <Box minH="100dvh" bg="bg.canvas" color="fg">
        <Box maxW="md" mx="auto" minH="100dvh" display="flex" flexDirection="column" px="4" pt="6" pb="8" gap="4">
          <Skeleton h="20" borderRadius="lg" />
          <Skeleton h="32" borderRadius="lg" />
          <Skeleton h="24" borderRadius="lg" />
        </Box>
      </Box>
    );
  }

  return (
    <Box minH="100dvh" bg="bg.canvas" color="fg" position="relative">
      {/* Reconnecting / status banner */}
      <Box
        position="sticky"
        top="0"
        zIndex="40"
        display={connectionState === 'reconnecting' ? 'block' : 'none'}
        bg="orange.solid"
        color="orange.fg"
        role="status"
        aria-live="polite"
      >
        <Flex justify="center" align="center" py="1.5" px="4" gap="2" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
          <WifiOff size={14} />
          <span>Reconnecting — Your responses are safe</span>
        </Flex>
      </Box>

      <Box maxW="md" mx="auto" minH="100dvh" display="flex" flexDirection="column" px="4" pt="4" pb="32" gap="4">
        {/* Top status strip */}
        <Flex align="center" justify="space-between" borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" px="3" py="2">
          <Text color="fg.muted" fontSize="xs" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
            Session: {code}
          </Text>
          <ConnectionStatus state={connectionState} />
        </Flex>

        {/* Slide badge */}
        <Flex align="center" justify="space-between" borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" px="3" py="2">
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
            Active Slide
          </Text>
          <Text fontFamily="mono" fontSize="2xl" fontWeight="bold">
            {String(slideNumber ?? '—').padStart(2, '0')}
          </Text>
        </Flex>

        {bootError && !ended && (
          <Alert.Root status="warning" borderRadius="lg" size="sm">
            <Alert.Indicator />
            <Box>
              <Alert.Title>Couldn&apos;t load session state</Alert.Title>
              <Alert.Description>{bootError}</Alert.Description>
            </Box>
          </Alert.Root>
        )}

        {ended && (
          <Card>
            <VStack gap="3" textAlign="center">
              <Icon color="red.solid" boxSize="8">
                <StopCircle />
              </Icon>
              <Heading size="md" textTransform="uppercase" letterSpacing="tight">
                Session Ended
              </Heading>
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                Thank you for your feedback.
              </Text>
            </VStack>
          </Card>
        )}

        {waiting && !ended && (
          <Card>
            <VStack gap="3" textAlign="center">
              <Box position="relative" w="12" h="12" display="grid" placeItems="center">
                <Box
                  position="absolute"
                  inset="0"
                  borderWidth="2px"
                  borderColor="border.emphasized"
                  borderTopColor="green.solid"
                  borderRadius="full"
                  animation="spin 1s linear infinite"
                />
                <Icon color="fg.muted" boxSize="6">
                  <Hourglass />
                </Icon>
              </Box>
              <Heading size="md" textTransform="uppercase" letterSpacing="tight">
                Awaiting Presenter
              </Heading>
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                The presentation will begin shortly. Keep this screen open.
              </Text>
            </VStack>
          </Card>
        )}

        {active && !ended && (
          <VStack gap="4" align="stretch">
            {/* Slide card */}
            <Card>
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" borderBottomWidth="1px" borderColor="border.subtle" px="4" py="2" mx="-4" mt="-4" mb="1">
                Query Data
              </Text>
              {hasContent ? (
                <Box>
                  {event!.slide?.title && (
                    <Heading size="md" mb="1" textTransform="uppercase" letterSpacing="tight">
                      {event!.slide.title}
                    </Heading>
                  )}
                  {event!.slide?.summary && (
                    <Text color="fg.muted" fontSize="sm" lineHeight="relaxed">
                      {event!.slide.summary}
                    </Text>
                  )}
                </Box>
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
            </Card>

            {/* Slide feedback form */}
            {rule?.enabled && rule.type !== 'disabled' &&
              (locked ? (
                <Card>
                  <VStack gap="2" textAlign="center" py="2">
                    <Icon color="green.solid" boxSize="6">
                      <CheckCircle2 />
                    </Icon>
                    <Text fontWeight="medium">
                      You answered: <strong className="capitalize">{existing?.responseValue ?? '—'}</strong>
                    </Text>
                    <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                      This slide does not allow changes.
                    </Text>
                  </VStack>
                </Card>
              ) : (
                <FeedbackForm rule={rule} value={slideValue} onChange={setSlideValue} />
              ))}

            {/* Default questions */}
            {defaultQuestions.map((dq) => (
              <DefaultQuestionForm
                key={dq.id}
                question={dq}
                value={defaultValues[dq.id] ?? ''}
                onChange={(v) => setDefaultValues((prev) => ({ ...prev, [dq.id]: v }))}
              />
            ))}

            {/* Status messages */}
            {status.kind === 'ok' && (
              <HStack gap="1.5" color="green.solid" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                <CheckCircle2 size={16} />
                <span>{status.message}</span>
              </HStack>
            )}
            {status.kind === 'error' && (
              <HStack gap="1.5" color="red.solid" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                <AlertCircleIcon />
                <span>{status.message}</span>
              </HStack>
            )}
          </VStack>
        )}
      </Box>

      {/* Bottom-anchored submit bar */}
      {active && !ended && canSubmit && (
        <Box
          position="fixed"
          bottom="0"
          left="0"
          right="0"
          zIndex="30"
          bg="bg.panel"
          borderTopWidth="1px"
          borderColor="border.subtle"
          px="4"
          pt="3"
          pb="calc(env(safe-area-inset-bottom, 0px) + 12px)"
        >
          <Box maxW="md" mx="auto">
            <Button
              onClick={submitAll}
              colorPalette="green"
              size="lg"
              w="full"
              disabled={status.kind === 'submitting'}
            >
              {status.kind === 'submitting' ? 'Submitting…' : 'Submit Response'}
              <Send size={18} />
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" px="4" py="4">
      {children}
    </Box>
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

function AlertCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}
