import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  SimpleGrid,
  Tag,
  Text,
  VStack,
} from '@chakra-ui/react';
import { ArrowLeft, Sparkles, Star } from 'lucide-react';
import { api, ApiError } from '../../api';
import type {
  SessionAnalytics,
  SlideAnalytics,
  FieldAnalytics,
  FieldStats,
  DefaultQuestionAnalytics,
} from '../../types';
import { SkeletonRows } from '../../components/ui/skeleton';
import { useToast } from '../../lib/toast';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard } from '../../components/ui/stat-card';

const TYPE_COLORS: Record<string, string> = {
  boolean: 'green',
  single_select: 'blue',
  multi_select: 'orange',
  rating: 'gray',
  nps: 'green',
  text: 'red',
  textarea: 'red',
};

const TYPE_LABELS: Record<string, string> = {
  boolean: 'Yes / No',
  single_select: 'Single Select',
  multi_select: 'Multi Select',
  rating: 'Rating',
  nps: 'NPS',
  text: 'Free Text',
  textarea: 'Free Text',
};

const SENTIMENT_COLOR: Record<string, string> = {
  positive: 'green',
  negative: 'red',
  neutral: 'gray',
  mixed: 'orange',
};

// Per-slide accent palette — cycles so every slide card has a distinct identity.
const SLIDE_ACCENTS = [
  { solid: '#10b981', tint: '#ecfdf5' },
  { solid: '#3b82f6', tint: '#eff6ff' },
  { solid: '#f59e0b', tint: '#fffbeb' },
  { solid: '#8b5cf6', tint: '#f5f3ff' },
  { solid: '#ec4899', tint: '#fdf2f8' },
  { solid: '#14b8a6', tint: '#f0fdfa' },
  { solid: '#f97316', tint: '#fff7ed' },
  { solid: '#6366f1', tint: '#eef2ff' },
];

type StatsOf<K extends FieldStats['kind']> = Extract<FieldStats, { kind: K }>;

export default function SessionAnalytics() {
  const { code = '' } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ['analytics', code],
    queryFn: () => api.sessionAnalytics(code),
    enabled: !!code,
    staleTime: 30_000,
  });

  const aiMut = useMutation({
    mutationFn: () => api.runSessionAi(code),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['analytics', code], fresh);
      toast.push('success', 'AI analysis complete');
    },
    onError: (e) => toast.push('error', e instanceof ApiError ? e.message : 'AI analysis failed'),
  });

  const data = q.data ?? null;

  if (q.isLoading) {
    return <SkeletonRows rows={4} />;
  }

  if (q.isError || !data) {
    return (
      <Alert.Root status="error" borderRadius="lg">
        <Alert.Indicator />
        <Alert.Title>Analytics unavailable for this session.</Alert.Title>
      </Alert.Root>
    );
  }

  const totalResponses = data.slides.reduce(
    (a, s) => a + s.fields.reduce((b, f) => b + f.responseCount, 0),
    0,
  );
  const ratingFields = data.slides.flatMap((s) => s.fields).filter((f) => f.stats.kind === 'rating');
  const avgRating =
    ratingFields.length > 0
      ? ratingFields.reduce((a, f) => a + (f.stats.kind === 'rating' ? f.stats.average : 0), 0) / ratingFields.length
      : null;
  const npsFields = data.slides.flatMap((s) => s.fields).filter((f) => f.stats.kind === 'nps');
  const avgNps =
    npsFields.length > 0
      ? npsFields.reduce((a, f) => a + (f.stats.kind === 'nps' ? f.stats.nps : 0), 0) / npsFields.length
      : null;

  return (
    <VStack gap="6" align="stretch">
      <PageHeader
        eyebrow="Session Analytics"
        title={data.session.presentation}
        description={`Code: ${data.session.code} · ${data.session.status} · ${data.session.slideCount} slides`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => aiMut.mutate()}
              disabled={aiMut.isPending || !data.hasAi || !data.aiConfigured}
              title={
                !data.aiConfigured
                  ? 'Set OPENROUTER_API_KEY in worker/.dev.vars'
                  : !data.hasAi
                    ? 'No free-text responses to analyze'
                    : 'Run theme clustering + sentiment on all free-text fields'
              }
            >
              <Sparkles size={16} />
              {aiMut.isPending ? 'Analyzing…' : 'Run AI Analysis'}
            </Button>
            <Link to={`/admin/sessions/${code}/results`}>
              <Button variant="outline">
                <ArrowLeft size={16} />
                Results
              </Button>
            </Link>
          </>
        }
      />

      {/* KPI row */}
      <SimpleGrid columns={{ base: 2, lg: 4 }} gap="4">
        <StatCard label="Participants" value={String(data.session.participantCount)} icon={<UsersIcon />} />
        <StatCard label="Responses" value={totalResponses.toLocaleString()} icon={<Star size={16} />} />
        <StatCard label="Avg Rating" value={avgRating !== null ? avgRating.toFixed(1) : '—'} icon={<Star size={16} />} />
        <StatCard label="Avg NPS" value={avgNps !== null ? avgNps.toFixed(0) : '—'} icon={<GaugeIcon />} />
      </SimpleGrid>

      {/* Per-slide sections */}
      {data.slides.map((slide) => (
        <SlideSection key={slide.slideNumber} slide={slide} busy={aiMut.isPending} />
      ))}

      {/* Default questions */}
      {data.defaultQuestions.length > 0 && (
        <Box>
          <HStack gap="2" mb="3">
            <Sparkles size={18} color="var(--chakra-colors-green-solid)" />
            <Text fontWeight="bold" textTransform="uppercase" letterSpacing="wide">
              Default Questions
            </Text>
          </HStack>
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4">
            {data.defaultQuestions.map((dq) => (
              <DefaultQuestionCard key={dq.id} dq={dq} />
            ))}
          </SimpleGrid>
        </Box>
      )}

      {!data.hasAi && (
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
          No free-text responses collected — AI analysis not available.
        </Text>
      )}
    </VStack>
  );
}

function SlideSection({ slide, busy }: { slide: SlideAnalytics; busy: boolean }) {
  const hasFields = slide.fields.length > 0;
  const accent = SLIDE_ACCENTS[(slide.slideNumber - 1) % SLIDE_ACCENTS.length];
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" overflow="hidden" bg="bg.surface" position="relative">
      <Box position="absolute" insetY="0" left="0" w="1.5" bg={accent.solid} />
      {/* Slide header */}
      <Box px="5" py="4" pl="6" borderBottomWidth="1px" borderColor="border.subtle">
        <Flex flexWrap="wrap" align="center" justify="space-between" gap="3">
          <HStack gap="3">
            <Tag.Root
              bg={accent.solid}
              color="#fff"
              size="sm"
              fontFamily="mono"
              textTransform="uppercase"
              letterSpacing="wider"
            >
              Slide {String(slide.slideNumber).padStart(2, '0')}
            </Tag.Root>
            {slide.title && (
              <Text fontWeight="bold" textTransform="uppercase" letterSpacing="wide" truncate>
                {slide.title}
              </Text>
            )}
          </HStack>
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
            {slide.fields.reduce((a, f) => a + f.responseCount, 0)} responses
          </Text>
        </Flex>
        {slide.summary && (
          <Text color="fg.muted" fontSize="sm" mt="2" lineHeight="relaxed" maxW="3xl">
            {slide.summary}
          </Text>
        )}
      </Box>

      {!hasFields ? (
        <Box px="5" py="6" textAlign="center">
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
            No feedback configured for this slide
          </Text>
        </Box>
      ) : (
        <VStack gap="0" align="stretch">
          {slide.fields.map((f, i) => (
            <FieldRow key={f.fieldId} field={f} divider={i > 0} busy={busy} />
          ))}
        </VStack>
      )}
    </Box>
  );
}

function FieldRow({ field, divider, busy }: { field: FieldAnalytics; divider: boolean; busy: boolean }) {
  const palette = TYPE_COLORS[field.fieldType] ?? 'gray';
  return (
    <Box px="5" py="5" borderTopWidth={divider ? '1px' : '0'} borderColor="border.subtle">
      <Flex flexWrap="wrap" align="flex-start" justify="space-between" gap="3" mb="4">
        <Box minW="0" flex="1">
          <Tag.Root colorPalette={palette} variant="surface" size="sm" textTransform="uppercase" fontSize="xs">
            {TYPE_LABELS[field.fieldType] ?? field.fieldType}
          </Tag.Root>
          <Text fontWeight="semibold" mt="2" fontSize="sm">
            {field.label}
          </Text>
        </Box>
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" flexShrink="0">
          {field.responseCount}/{field.participantCount || '—'} responded
        </Text>
      </Flex>
      <FieldVisual field={field} busy={busy} />
    </Box>
  );
}

function FieldVisual({ field, busy }: { field: FieldAnalytics; busy: boolean }) {
  switch (field.stats.kind) {
    case 'boolean':
      return <BooleanVisual stats={field.stats} />;
    case 'single_select':
      return <BarVisual counts={field.stats.counts} />;
    case 'multi_select':
      return <MultiVisual stats={field.stats} options={field.options ?? []} />;
    case 'rating':
      return <RatingVisual stats={field.stats} />;
    case 'nps':
      return <NpsVisual stats={field.stats} />;
    case 'text':
      return <TextVisual stats={field.stats} busy={busy} />;
    default:
      return null;
  }
}

// --- Boolean: donut + headline ---
function BooleanVisual({ stats }: { stats: StatsOf<'boolean'> }) {
  const pct = stats.yesPct;
  const total = stats.yesCount + stats.noCount;
  return (
    <Flex flexWrap="wrap" align="center" gap="8">
      <Box
        position="relative"
        w="36"
        h="36"
        borderRadius="full"
        bg={`conic-gradient(#10b981 0 ${pct}%, #ef4444 ${pct}% 100%)`}
        aria-label={`${pct.toFixed(0)}% yes`}
        flexShrink="0"
      >
        <Box
          position="absolute"
          inset="3"
          borderRadius="full"
          bg="bg.surface"
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
        >
          <Text fontSize="2xl" fontWeight="bold" color="green.solid">
            {pct.toFixed(0)}%
          </Text>
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
            Yes
          </Text>
        </Box>
      </Box>
      <VStack gap="2" align="flex-start">
        <Legend color="#10b981" label={`Yes — ${stats.yesCount}`} />
        <Legend color="#ef4444" label={`No — ${stats.noCount}`} />
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mt="1">
          {total} total
        </Text>
      </VStack>
    </Flex>
  );
}

// --- Single-select / multi-select frequency: horizontal bars ---
function BarVisual({ counts }: { counts: Record<string, number> }) {
  const entries = useMemo(
    () =>
      Object.entries(counts)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
    [counts],
  );
  const total = entries.reduce((a, e) => a + e.value, 0) || 1;
  const max = entries.reduce((a, e) => Math.max(a, e.value), 0) || 1;

  if (entries.length === 0) return <EmptyNote />;

  return (
    <VStack gap="2.5" align="stretch" maxW="2xl">
      {entries.map((e) => (
        <Flex key={e.label} align="center" gap="3">
          <Text fontSize="sm" minW="140px" truncate>
            {e.label}
          </Text>
          <Box flex="1" h="3" bg="bg.muted" borderRadius="full" overflow="hidden">
            <Box h="full" bg="green.solid" borderRadius="full" style={{ width: `${(e.value / max) * 100}%` }} title={`${e.value} (${((e.value / total) * 100).toFixed(0)}%)`} />
          </Box>
          <Text fontSize="sm" color="fg.muted" w="10" textAlign="right">
            {e.value}
          </Text>
          <Text fontSize="xs" color="fg.muted" w="12" textAlign="right">
            {((e.value / total) * 100).toFixed(0)}%
          </Text>
        </Flex>
      ))}
    </VStack>
  );
}

// --- Multi-select: frequency + co-occurrence ---
function MultiVisual({ stats, options }: { stats: StatsOf<'multi_select'>; options: string[] }) {
  const picked = options.filter((o) => (stats.counts[o] ?? 0) > 0);
  const coPairs = useMemo(() => {
    const pairs: { a: string; b: string; n: number }[] = [];
    for (const a of picked) {
      const withB = stats.coOccurrence[a] ?? {};
      for (const [b, n] of Object.entries(withB)) {
        if (n > 0) pairs.push({ a, b, n });
      }
    }
    return pairs.sort((x, y) => y.n - x.n).slice(0, 8);
  }, [picked, stats.coOccurrence]);

  return (
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap="6">
      <Box>
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="2">
          Option frequency
        </Text>
        <BarVisual counts={stats.counts} />
      </Box>
      <Box>
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="2">
          Co-occurrence — people who picked A also picked B
        </Text>
        {coPairs.length === 0 ? (
          <EmptyNote />
        ) : (
          <VStack gap="1.5" align="stretch" maxW="2xl">
            {coPairs.map((p) => (
              <Flex key={`${p.a}-${p.b}`} align="center" gap="2" fontSize="sm">
                <Tag.Root variant="surface" colorPalette="gray" size="sm" truncate maxW="40">
                  {p.a}
                </Tag.Root>
                <Icon color="fg.muted" boxSize="3.5">
                  <ArrowRightIcon />
                </Icon>
                <Tag.Root variant="surface" colorPalette="gray" size="sm" truncate maxW="40">
                  {p.b}
                </Tag.Root>
                <Text color="fg.muted" ml="auto" flexShrink="0">
                  {p.n}×
                </Text>
              </Flex>
            ))}
          </VStack>
        )}
      </Box>
    </SimpleGrid>
  );
}

// --- Rating: distribution histogram ---
function RatingVisual({ stats }: { stats: StatsOf<'rating'> }) {
  return (
    <Box maxW="xl">
      <Flex align="flex-end" gap="1" h="32">
        {Object.entries(stats.distribution)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([k, v]) => {
            const max = Math.max(...Object.values(stats.distribution), 1);
            return (
              <Flex key={k} flex="1" flexDirection="column" align="center" gap="1" h="full" justify="flex-end">
                <Box
                  w="full"
                  maxW="22px"
                  bg="green.solid"
                  style={{ height: `${(v / max) * 100}%` }}
                  title={`${k}: ${v}`}
                  borderRadius="sm"
                />
                <Text fontSize="xs" color="fg.muted">
                  {k}
                </Text>
              </Flex>
            );
          })}
      </Flex>
      <HStack gap="3" mt="3" fontSize="sm">
        <Star size={16} color="var(--chakra-colors-green-solid)" />
        <Text fontWeight="semibold">Average {stats.average.toFixed(1)}</Text>
        <Text color="fg.muted">· {Object.values(stats.distribution).reduce((a, b) => a + b, 0)} responses</Text>
      </HStack>
    </Box>
  );
}

// --- NPS: gauge + promoters/detractors breakdown ---
function NpsVisual({ stats }: { stats: StatsOf<'nps'> }) {
  const clamped = Math.max(-100, Math.min(100, stats.nps));
  const color = clamped >= 50 ? '#10b981' : clamped >= 0 ? '#f59e0b' : '#ef4444';
  return (
    <Flex flexWrap="wrap" align="center" gap="8">
      <Box w="44" h="24" position="relative" overflow="hidden" aria-label={`NPS ${stats.nps.toFixed(0)}`}>
        <Box
          w="44"
          h="44"
          borderRadius="full"
          border="14px solid"
          borderColor={color}
          transform="rotate(45deg)"
          clipPath="polygon(0 50%, 100% 50%, 100% 100%, 0 100%)"
        />
        <Flex position="absolute" inset="0" flexDirection="column" align="center" justify="flex-end" pb="1">
          <Text fontSize="2xl" fontWeight="bold" color={color}>
            {stats.nps > 0 ? '+' : ''}
            {stats.nps.toFixed(0)}
          </Text>
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
            NPS
          </Text>
        </Flex>
      </Box>
      <VStack gap="1.5" align="flex-start">
        <Legend color="#10b981" label="Promoters (9–10)" />
        <Legend color="#f59e0b" label="Passives (7–8)" />
        <Legend color="#ef4444" label="Detractors (0–6)" />
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mt="1">
          {Object.values(stats.distribution).reduce((a, b) => a + b, 0)} responses
        </Text>
      </VStack>
    </Flex>
  );
}

// --- Free text: word cloud + AI themes/sentiment ---
function TextVisual({ stats, busy }: { stats: StatsOf<'text'>; busy: boolean }) {
  const words = useMemo(() => wordFrequency(stats.responses), [stats.responses]);
  const insight = stats.insight;
  const sentiment = insight ? SENTIMENT_COLOR[insight.sentiment] : null;

  return (
    <VStack gap="6" align="stretch">
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="6">
        {/* Word cloud */}
        <Box>
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="2">
            Word cloud — {stats.responses.length} responses
          </Text>
          {words.length === 0 ? (
            <EmptyNote />
          ) : (
            <Flex flexWrap="wrap" gapX="3" gapY="1.5" align="baseline" borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.muted" p="4">
              {words.slice(0, 40).map((w) => (
                <Text
                  key={w.word}
                  as="span"
                  fontFamily="mono"
                  display="inline-block"
                  style={{ fontSize: `${Math.max(11, Math.min(30, 10 + w.count * 1.6))}px`, color: wordColor(w.word, words.length) }}
                  title={`${w.word}: ${w.count}`}
                >
                  {w.word}
                </Text>
              ))}
            </Flex>
          )}
        </Box>

        {/* AI insight panel */}
        <Box>
          <Flex align="center" justify="space-between" mb="2">
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
              AI insights
            </Text>
            {!insight && (
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                Run via &quot;Run AI Analysis&quot; above
              </Text>
            )}
          </Flex>
          {insight && sentiment ? (
            <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.muted" p="4">
              <HStack gap="2" flexWrap="wrap">
                <Tag.Root colorPalette={sentiment} variant="surface" size="sm" textTransform="uppercase" fontSize="xs">
                  {insight.sentiment}
                </Tag.Root>
                <Text fontSize="sm" fontWeight="medium">
                  Score {insight.sentimentScore.toFixed(2)}
                </Text>
              </HStack>
              <Flex gap="1.5" flexWrap="wrap" mt="3">
                {insight.themes.map((t) => (
                  <Tag.Root key={t.name} colorPalette="green" variant="surface" size="sm" textTransform="uppercase" fontSize="xs">
                    {t.name} · {t.count}
                  </Tag.Root>
                ))}
              </Flex>
              <Text color="fg.muted" fontSize="sm" lineHeight="relaxed" mt="3">
                {insight.summary}
              </Text>
            </Box>
          ) : (
            <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.muted" p="4">
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                {busy ? 'Analyzing responses…' : 'No analysis yet. Click "Run AI Analysis" to generate themes + sentiment.'}
              </Text>
            </Box>
          )}
        </Box>
      </SimpleGrid>

      {/* Raw responses (collapsible) */}
      {stats.responses.length > 0 && (
        <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.muted">
          <Text px="4" py="2" color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" cursor="pointer">
            View {stats.responses.length} response{stats.responses.length === 1 ? '' : 's'}
          </Text>
          <VStack gap="0" align="stretch" borderTopWidth="1px" borderColor="border.subtle">
            {stats.responses.map((r, i) => (
              <Text key={i} px="4" py="2.5" fontSize="sm" color="fg.muted">
                <Text as="span" color="fg.subtle" fontSize="xs" fontFamily="mono" mr="2">
                  {String(i + 1).padStart(2, '0')}
                </Text>
                {r}
              </Text>
            ))}
          </VStack>
        </Box>
      )}
    </VStack>
  );
}

// --- Default questions ---
function DefaultQuestionCard({ dq }: { dq: DefaultQuestionAnalytics }) {
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="5">
      <Flex align="center" justify="space-between" gap="2" mb="3">
        <Tag.Root colorPalette="green" variant="surface" size="sm" textTransform="uppercase" fontSize="xs">
          {dq.questionType === 'rating' ? 'Rating' : 'Interested?'}
        </Tag.Root>
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
          {dq.responseCount}/{dq.participantCount || '—'} responded
        </Text>
      </Flex>
      <Text fontWeight="semibold" mb="4" fontSize="sm">
        {dq.questionText}
      </Text>
      {dq.questionType === 'rating' ? (
        <RatingVisual stats={dq.stats as StatsOf<'rating'>} />
      ) : (
        <InterestedVisual stats={dq.stats as InterestedStats} />
      )}
    </Box>
  );
}

type InterestedStats = Extract<DefaultQuestionAnalytics['stats'], { kind: 'interested' }>;

function InterestedVisual({ stats }: { stats: InterestedStats }) {
  return (
    <Flex align="center" gap="6">
      <Box>
        <Text fontSize="2xl" fontWeight="bold" color="green.solid">
          {stats.interestedPct.toFixed(0)}%
        </Text>
        <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
          Interested
        </Text>
      </Box>
      <VStack gap="1" align="flex-start">
        <Legend color="#10b981" label={`Interested (${stats.interestedCount})`} />
        <Legend color="#ef4444" label={`Not interested (${stats.notInterestedCount})`} />
      </VStack>
    </Flex>
  );
}

// ============================================================================
// Small helpers
// ============================================================================

function EmptyNote() {
  return (
    <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" py="3">
      No data yet
    </Text>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Flex align="center" gap="2" fontSize="sm">
      <Box w="3" h="3" bg={color} borderRadius="sm" />
      <Text>{label}</Text>
    </Flex>
  );
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'we', 'they', 'he', 'she', 'them', 'their', 'my', 'your', 'our', 'as', 'so',
  'if', 'then', 'than', 'too', 'very', 'just', 'like', 'about', 'from', 'not', 'no', 'yes',
  'really', 'very', 'also', 'get', 'got', 'one', 'two', 'can', 'will', 'would', 'could',
  'should', 'have', 'has', 'had', 'do', 'does', 'did', 'there', 'here', 'what', 'when',
  'where', 'which', 'who', 'how', 'more', 'most', 'some', 'any', 'all', 'each', 'every',
]);

function wordFrequency(responses: string[]): { word: string; count: number }[] {
  const freq = new Map<string, number>();
  for (const r of responses) {
    const tokens = r
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .filter((w) => w.count >= 2)
    .slice(0, 60);
}

function wordColor(word: string, totalWords: number): string {
  const palette = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#0a0a0a', '#525252', '#14b8a6'];
  let h = 0;
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function GaugeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
