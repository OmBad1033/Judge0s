import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Icon,
  IconButton,
  Progress,
  Separator,
  SimpleGrid,
  Spinner,
  Text,
  Tooltip,
  VStack,
} from '@chakra-ui/react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  Group,
  Pause,
  Play,
  Share2,
  StopCircle,
  Users,
} from 'lucide-react';
import { api, ApiError } from '../../api';
import { usePresentationSocket } from '../../usePresentationSocket';
import type { Session, ControlState, SessionParticipant, SlideEventRule } from '../../types';
import { liveAggregate } from '../../lib/metrics';
import { useToast } from '../../lib/toast';
import ConnectionStatus from '../../components/ConnectionStatus';
import SessionQRCode from '../../components/SessionQRCode';
import { SkeletonRows } from '../../components/ui/skeleton';
import FeedbackForm from '../../components/FeedbackForm';
import DefaultQuestionForm from '../../components/DefaultQuestionForm';
import { PageHeader } from '../../components/ui/page-header';

export default function ControlSession() {
  const { code } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showSlidePicker, setShowSlidePicker] = useState(false);
  const [copied, setCopied] = useState(false);
  const { event, stats, statsV2, connected } = usePresentationSocket(code);
  const queryKey = ['control-state', code];

  const sessionQ = useQuery({
    queryKey: ['session', code],
    queryFn: () => api.getSession(code!),
    enabled: !!code,
    refetchInterval: 15_000,
  });

  const controlQ = useQuery({
    queryKey,
    queryFn: () => api.controlState(code!),
    enabled: !!code,
  });

  useEffect(() => {
    if (event?.type === 'SLIDE_CHANGED') {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['participants', code] });
    }
  }, [event, queryClient, queryKey, code]);

  useEffect(() => {
    if (sessionQ.data) setSession(sessionQ.data);
  }, [sessionQ.data]);

  const startMut = useMutation({
    mutationFn: () => api.startSession(code!),
    onSuccess: (s) => {
      setSession(s);
      queryClient.invalidateQueries({ queryKey: ['session', code] });
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Start failed'),
  });

  const endMut = useMutation({
    mutationFn: () => api.endSession(code!),
    onSuccess: (s) => {
      setSession(s);
      queryClient.invalidateQueries({ queryKey: ['session', code] });
      queryClient.invalidateQueries({ queryKey });
      toast.push('info', 'Session ended.');
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'End failed'),
  });

  const slideMut = useMutation({
    mutationFn: (n: number) => api.changeSlide(code!, n),
    onSuccess: (s) => {
      setSession(s);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Slide change failed'),
  });

  const pauseMut = useMutation({
    mutationFn: () => api.pauseSession(code!),
    onSuccess: (s) => {
      setSession(s);
      toast.push('warning', 'Session paused.');
    },
    onError: (e) => {
      if (!(e instanceof ApiError)) setErr('Pause failed');
    },
  });

  const resumeMut = useMutation({
    mutationFn: () => api.resumeSession(code!),
    onSuccess: (s) => {
      setSession(s);
      toast.push('success', 'Session resumed.');
    },
    onError: (e) => {
      if (!(e instanceof ApiError)) setErr('Resume failed');
    },
  });

  const participantsQ = useQuery({
    queryKey: ['participants', code],
    queryFn: () => api.listSessionParticipants(code!),
    enabled: !!code && session?.status === 'live',
    retry: false,
    refetchInterval: 10_000,
  });

  const currentSlideQ = useQuery({
    queryKey: ['current-slide', code],
    queryFn: () => api.currentSlide(code!),
    enabled: !!code && (session?.status === 'live' || session?.status === 'paused'),
    refetchInterval: (q) => (q.state.data ? 5_000 : 10_000),
    refetchOnWindowFocus: false,
  });

  const copyCode = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.sessionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.push('success', 'Code copied');
    } catch {
      toast.push('error', 'Copy failed');
    }
  };

  const shareLink = async () => {
    if (!session || !code) return;
    const url = `${window.location.origin}/join/${encodeURIComponent(code)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: session.presentationTitle, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.push('success', 'Link copied');
      }
    } catch {
      /* user cancelled */
    }
  };

  if (sessionQ.isLoading || !session) {
    return <SkeletonRows rows={4} />;
  }

  if (sessionQ.error) {
    return (
      <Alert.Root status="error" borderRadius="lg">
        <Alert.Indicator />
        <Alert.Title>Session not found.</Alert.Title>
      </Alert.Root>
    );
  }

  const current = session.currentSlideNumber ?? 0;
  const max = session.slideCount;
  const slide = event?.type === 'SLIDE_CHANGED' ? event.slide : undefined;
  const participantCount = stats?.participantCount ?? controlQ.data?.participantCount ?? 0;
  const currentResponses = stats?.currentSlideResponseCount ?? controlQ.data?.currentSlideResponseCount ?? 0;
  const score = liveAggregate(participantCount, currentResponses);

  const liveEvent = currentSlideQ.data ?? event;
  const liveRule: SlideEventRule | null = liveEvent?.type === 'SLIDE_CHANGED' ? (liveEvent.feedbackRule ?? null) : null;
  const liveDefaultQuestions = liveEvent?.type === 'SLIDE_CHANGED' ? (liveEvent.defaultQuestions ?? []) : [];
  const liveSlide = liveEvent?.type === 'SLIDE_CHANGED' ? (liveEvent.slide ?? undefined) : undefined;

  const isLive = session.status === 'live';
  const isDraft = session.status === 'draft';
  const isEnded = session.status === 'ended';
  const isPaused = session.status === 'paused';

  return (
    <Box pb={{ base: '28', lg: '6' }}>
      <PageHeader
        eyebrow={session.status.toUpperCase()}
        title={session.presentationTitle}
        description={`${max} Slides · ${participantCount} Participants`}
        actions={
          <>
            <ConnectionStatus state={connected ? 'connected' : 'reconnecting'} size="md" />
            <Button variant="outline" onClick={copyCode} title="Copy code">
              <Text fontFamily="mono" fontWeight="bold" fontSize="lg">
                {session.sessionCode}
              </Text>
              {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
            </Button>
            {(isLive || isPaused) && (
              <Button colorPalette="red" onClick={() => endMut.mutate()} disabled={endMut.isPending} display={{ base: 'none', lg: 'inline-flex' }}>
                <StopCircle size={16} />
                End Session
              </Button>
            )}
          </>
        }
      />

      {err && (
        <Alert.Root status="error" borderRadius="lg" mb="4">
          <Alert.Indicator />
          <Alert.Title>{err}</Alert.Title>
        </Alert.Root>
      )}

      {/* DRAFT — LOBBY */}
      {isDraft && (
        <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap="4">
          <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="6" textAlign="center">
            <VStack gap="3">
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                Pre-Flight
              </Text>
              <Heading size="lg" textTransform="uppercase" letterSpacing="tight">
                Session Ready
              </Heading>
              <Text color="fg.muted" fontSize="sm" maxW="md">
                Participants can join the lobby using the code below. They won&apos;t see the presentation
                until you go live.
              </Text>
              <Button colorPalette="green" size="lg" mt="2" onClick={() => startMut.mutate()} disabled={startMut.isPending}>
                <SensorsIcon />
                {startMut.isPending ? 'Starting…' : 'Go Live'}
              </Button>
            </VStack>
          </Box>

          <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="5" display="flex" flexDirection="column" alignItems="center" justifyContent="center" gap="3">
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
              Share with Participants
            </Text>
            <SessionQRCode code={session.sessionCode} size={180} />
            <Button variant="outline" onClick={shareLink}>
              <Share2 size={16} />
              Share Link
            </Button>
          </Box>
        </Grid>
      )}

      {/* LIVE / PAUSED */}
      {(isLive || isPaused) && (
        <Grid templateColumns={{ base: '1fr', lg: '8fr 4fr' }} gap="4">
          {/* LEFT — slide + stats */}
          <VStack gap="4" align="stretch">
            <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" overflow="hidden">
              <Flex align="center" justify="space-between" px="4" py="2" borderBottomWidth="1px" borderColor="border.subtle">
                <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                  Current Slide
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSlidePicker((v) => !v)}
                  fontFamily="mono"
                >
                  {String(current).padStart(2, '0')} / {String(max).padStart(2, '0')}
                  {showSlidePicker ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </Button>
              </Flex>

              {showSlidePicker && (
                <SlidePicker
                  max={max}
                  current={current}
                  slides={controlQ.data?.slides ?? []}
                  onPick={(n) => {
                    slideMut.mutate(n);
                    setShowSlidePicker(false);
                  }}
                />
              )}

              <Box position="relative" bg="bg.muted" p="6" minH="240px">
                <IconButton
                  aria-label="Previous slide"
                  variant="outline"
                  position="absolute"
                  left="2"
                  top="1/2"
                  transform="translateY(-50%)"
                  zIndex="10"
                  display={{ base: 'none', lg: 'inline-flex' }}
                  onClick={() => slideMut.mutate(Math.max(1, current - 1))}
                  disabled={busy || current <= 1}
                >
                  <ChevronLeft size={20} />
                </IconButton>
                <IconButton
                  aria-label="Next slide"
                  variant="outline"
                  position="absolute"
                  right="2"
                  top="1/2"
                  transform="translateY(-50%)"
                  zIndex="10"
                  display={{ base: 'none', lg: 'inline-flex' }}
                  onClick={() => slideMut.mutate(Math.min(max, current + 1))}
                  disabled={busy || current >= max}
                >
                  <ChevronRight size={20} />
                </IconButton>

                <VStack justify="center" minH="200px" textAlign="center" gap="2">
                  <Heading size="lg" textTransform="uppercase" letterSpacing="tight">
                    {slide?.title ?? `Slide ${String(current).padStart(2, '0')}`}
                  </Heading>
                  {slide?.summary ? (
                    <Text color="fg.muted" maxW="2xl">
                      {slide.summary}
                    </Text>
                  ) : (
                    <Text color="fg.muted" fontSize="sm">
                      No content
                    </Text>
                  )}
                </VStack>
              </Box>

              {/* Progress */}
              <Box px="4" py="3" borderTopWidth="1px" borderColor="border.subtle">
                <Progress.Root value={max ? (current / max) * 100 : 0} size="xs">
                  <Progress.Track>
                    <Progress.Range bg="green.solid" />
                  </Progress.Track>
                </Progress.Root>
              </Box>
            </Box>

            <HStack gap="2" display={{ base: 'none', lg: 'flex' }}>
              <Link to={`/admin/sessions/${code}/results`}>
                <Button variant="outline">
                  <Download size={16} />
                  View Results / Export
                </Button>
              </Link>
              <Link to={`/admin/sessions/${code}/analytics`}>
                <Button variant="outline">
                  <BarChart3 size={16} />
                  Analytics
                </Button>
              </Link>
            </HStack>
          </VStack>

          {/* RIGHT — phone preview + stats + participants */}
          <VStack gap="4" align="stretch">
            <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" overflow="hidden">
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" px="4" py="2" borderBottomWidth="1px" borderColor="border.subtle">
                User View — Phone
              </Text>
              <Box bg="bg.muted" p="4" display="flex" justifyContent="center">
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
                  <Flex justify="center" pt="2">
                    <Box w="16" h="1" bg="border.emphasized" borderRadius="full" />
                  </Flex>
                  <Box maxH="560px" overflowY="auto" p="4" display="flex" flexDirection="column" gap="4" pb="20">
                    <Flex align="center" justify="space-between" borderWidth="1px" borderColor="border.subtle" borderRadius="lg" px="3" py="2">
                      <Text color="fg.muted" fontSize="xs" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
                        Session: {session.sessionCode}
                      </Text>
                      <ConnectionStatus state={connected ? 'connected' : 'reconnecting'} />
                    </Flex>

                    <Flex align="center" justify="space-between" borderWidth="1px" borderColor="border.subtle" borderRadius="lg" px="3" py="2">
                      <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                        Active Slide
                      </Text>
                      <Text fontFamily="mono" fontSize="2xl" fontWeight="bold">
                        {String(current || 1).padStart(2, '0')}
                      </Text>
                    </Flex>

                    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface">
                      <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" px="4" py="2" borderBottomWidth="1px" borderColor="border.subtle">
                        Query Data
                      </Text>
                      <Box p="4">
                        {liveSlide?.title || liveSlide?.summary ? (
                          <>
                            {liveSlide?.title && (
                              <Heading size="sm" mb="1" textTransform="uppercase" letterSpacing="tight">
                                {liveSlide.title}
                              </Heading>
                            )}
                            {liveSlide?.summary && (
                              <Text color="fg.muted" fontSize="sm" lineHeight="relaxed">
                                {liveSlide.summary}
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

                    {liveRule?.enabled && liveRule.type !== 'disabled' ? (
                      <FeedbackForm rule={liveRule} value="" onChange={() => {}} />
                    ) : (
                      <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" p="6" textAlign="center">
                        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                          Feedback is disabled for this slide.
                        </Text>
                      </Box>
                    )}

                    {liveDefaultQuestions.map((dq) => (
                      <DefaultQuestionForm key={dq.id} question={dq} value="" onChange={() => {}} />
                    ))}
                  </Box>

                  <Box px="4" pt="3" pb="12px" borderTopWidth="1px" borderColor="border.subtle" bg="bg.panel">
                    <Button colorPalette="green" w="full" size="lg" disabled>
                      Submit Response
                    </Button>
                  </Box>
                </Box>
              </Box>
            </Box>

            {/* Live stats */}
            <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" overflow="hidden">
              <Button variant="ghost" w="full" justifyContent="space-between" px="4" py="2" onClick={() => setShowStats((v) => !v)}>
                <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                  Live Stats
                </Text>
                <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" display={{ base: 'inline', lg: 'none' }}>
                  {showStats ? 'Hide' : 'Show'}
                </Text>
              </Button>
              <Box p="4" display={showStats ? 'block' : { base: 'none', lg: 'block' }}>
                <SimpleGrid columns={2} gap="3">
                  <StatBox label="Engagement" value={`${score}%`} sub={`${currentResponses}/${participantCount} responses`} />
                  <StatBox label="Participants" value={String(participantCount)} sub={connected ? 'Live' : 'Reconnecting'} />
                </SimpleGrid>

                {statsV2?.currentSlide?.fieldBreakdown && statsV2.currentSlide.fieldBreakdown.length > 0 && (
                  <Box borderTopWidth="1px" borderColor="border.subtle" mt="4" pt="4">
                    <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="2">
                      Field Breakdown
                    </Text>
                    <VStack gap="3" align="stretch">
                      {statsV2.currentSlide.fieldBreakdown.map((f, i) => (
                        <FieldBreakdown key={i} field={f} />
                      ))}
                    </VStack>
                  </Box>
                )}
              </Box>
            </Box>

            <ParticipantList
              participants={participantsQ.data?.participants ?? []}
              participantCount={participantCount}
              loading={participantsQ.isLoading}
              isMock={participantsQ.isError}
            />
          </VStack>
        </Grid>
      )}

      {/* ENDED */}
      {isEnded && (
        <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" textAlign="center" py="10">
          <VStack gap="3">
            <Icon color="red.solid" boxSize="10">
              <StopCircle />
            </Icon>
            <Heading size="lg" textTransform="uppercase" letterSpacing="tight">
              Session Ended
            </Heading>
            <Text color="fg.muted">This feedback session is closed.</Text>
            <HStack gap="2" justify="center" flexWrap="wrap" mt="2">
              <Link to={`/admin/sessions/${code}/results`}>
                <Button colorPalette="green">
                  <Download size={16} />
                  View Results &amp; Export
                </Button>
              </Link>
              <Link to={`/admin/sessions/${code}/analytics`}>
                <Button variant="outline">
                  <BarChart3 size={16} />
                  Analytics
                </Button>
              </Link>
              <Link to="/admin/presentations">
                <Button variant="outline">Back to Library</Button>
              </Link>
            </HStack>
          </VStack>
        </Box>
      )}

      {/* MOBILE — bottom-anchored remote control bar */}
      {(isLive || isPaused) && (
        <Box
          position="fixed"
          bottom="0"
          left="0"
          right="0"
          zIndex="30"
          bg="bg.panel"
          borderTopWidth="1px"
          borderColor="border.subtle"
          px="3"
          pt="2"
          pb="calc(env(safe-area-inset-bottom, 0px) + 8px)"
          display={{ base: 'block', lg: 'none' }}
        >
          <SimpleGrid columns={4} gap="2">
            <Button
              variant="outline"
              onClick={() => slideMut.mutate(Math.max(1, current - 1))}
              disabled={busy || current <= 1}
              h="13"
            >
              <ArrowLeft size={18} />
            </Button>
            <Button colorPalette="green" onClick={() => slideMut.mutate(Math.min(max, current + 1))} disabled={busy || current >= max} h="13">
              <ArrowRight size={18} />
            </Button>
            {isPaused ? (
              <Button variant="outline" onClick={() => resumeMut.mutate()} disabled={resumeMut.isPending} h="13" aria-label="Resume">
                <Play size={18} />
              </Button>
            ) : (
              <Button variant="outline" onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending} h="13" aria-label="Pause">
                <Pause size={18} />
              </Button>
            )}
            <Button colorPalette="red" onClick={() => endMut.mutate()} disabled={endMut.isPending} h="13" aria-label="End">
              <StopCircle size={18} />
            </Button>
          </SimpleGrid>
        </Box>
      )}
    </Box>
  );
}

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.muted" px="3" py="2">
      <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
        {label}
      </Text>
      <Text fontSize="2xl" fontWeight="semibold" mt="1">
        {value}
      </Text>
      {sub && (
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mt="0.5">
          {sub}
        </Text>
      )}
    </Box>
  );
}

function FieldBreakdown({
  field,
}: {
  field:
    | { fieldId: string; feedbackType: 'boolean' | 'multiple_choice' | 'open_text'; counts: Record<string, number> }
    | { fieldId: string; questionType: 'interested' | 'rating'; average: number; count: number };
}) {
  if ('feedbackType' in field) {
    const total = Object.values(field.counts).reduce((a, b) => a + b, 0) || 1;
    const entries = Object.entries(field.counts).sort(([, a], [, b]) => b - a);
    return (
      <Box>
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="1">
          {field.feedbackType}
        </Text>
        <VStack gap="1.5" align="stretch">
          {entries.map(([k, v]) => (
            <Flex key={k} align="center" gap="2">
              <Text fontSize="sm" minW="120px" truncate>
                {k}
              </Text>
              <Progress.Root value={(v / total) * 100} size="xs" flex="1">
                <Progress.Track>
                  <Progress.Range bg="green.solid" />
                </Progress.Track>
              </Progress.Root>
              <Text fontSize="sm" color="fg.muted">
                {v}
              </Text>
            </Flex>
          ))}
        </VStack>
      </Box>
    );
  }
  return (
    <Box>
      <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="1">
        {field.questionType}
      </Text>
      <Text fontSize="2xl" fontWeight="semibold">
        {field.average.toFixed(1)}{' '}
        <Text as="span" color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
          avg
        </Text>
        <Text as="span" color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" ml="2">
          ({field.count} responses)
        </Text>
      </Text>
    </Box>
  );
}

function SlidePicker({
  max,
  current,
  slides,
  onPick,
}: {
  max: number;
  current: number;
  slides: { slideNumber: number; configured: boolean; title: string | null }[];
  onPick: (n: number) => void;
}) {
  return (
    <Box borderBottomWidth="1px" borderColor="border.subtle" bg="bg.muted" p="2" maxH="64" overflowY="auto">
      <SimpleGrid columns={{ base: 4, sm: 6, lg: 8 }} gap="1.5">
        {Array.from({ length: max }).map((_, i) => {
          const n = i + 1;
          const meta = slides.find((s) => s.slideNumber === n);
          const active = n === current;
          const configured = meta?.configured ?? false;
          return (
            <Button
              key={n}
              onClick={() => onPick(n)}
              variant={active ? 'solid' : configured ? 'outline' : 'ghost'}
              colorPalette={active ? 'green' : undefined}
              size="sm"
              fontFamily="mono"
              color={!active && !configured ? 'fg.muted' : undefined}
            >
              {String(n).padStart(2, '0')}
            </Button>
          );
        })}
      </SimpleGrid>
    </Box>
  );
}

function ParticipantList({
  participants,
  participantCount,
  loading,
  isMock,
}: {
  participants: SessionParticipant[];
  participantCount: number;
  loading: boolean;
  isMock: boolean;
}) {
  if (loading) {
    return <SkeletonRows rows={3} />;
  }

  if (isMock || participants.length === 0) {
    return (
      <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="4" textAlign="center">
        <VStack gap="2">
          <Icon color="fg.muted" boxSize="8">
            <Users />
          </Icon>
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
            Waiting for participants to join
          </Text>
          <Text fontWeight="medium">{participantCount} connected</Text>
        </VStack>
      </Box>
    );
  }

  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" overflow="hidden">
      <Flex align="center" justify="space-between" px="4" py="2" borderBottomWidth="1px" borderColor="border.subtle">
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
          Participants
        </Text>
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
          {participants.length} / {participantCount}
        </Text>
      </Flex>
      <VStack gap="0" maxH="96" overflowY="auto" align="stretch">
        {participants.map((p) => (
          <Flex key={p.id} align="center" gap="2" px="3" py="2" borderTopWidth="1px" borderColor="border.subtle" _first={{ borderTop: 'none' }}>
            <Box w="2" h="2" borderRadius="full" bg="green.solid" />
            <Text fontSize="sm" truncate flex="1">
              {p.name}
            </Text>
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
              {p.totalResponses} resp
            </Text>
          </Flex>
        ))}
      </VStack>
    </Box>
  );
}

function SensorsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
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
