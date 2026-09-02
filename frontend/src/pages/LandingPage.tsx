import { Link } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  Flex,
  Grid,
  Heading,
  HStack,
  Icon,
  Separator,
  SimpleGrid,
  Text,
  VStack,
} from '@chakra-ui/react';
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Gauge,
  Lock,
  Radio,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';

const FEATURES = [
  {
    icon: Radio,
    tag: 'Realtime',
    title: 'Live WebSocket Sync',
    desc: 'Session state streams over a Durable Object so every connected participant resolves the active slide in under 20ms.',
  },
  {
    icon: Gauge,
    tag: 'Scoring',
    title: 'Per-Slide Feedback',
    desc: 'Configure boolean, multiple choice, or open-text feedback per slide. Layer interest + 0–10 ratings across all slides.',
  },
  {
    icon: BarChart3,
    tag: 'Export',
    title: 'Structured Export',
    desc: 'Pull the full session JSON or CSV. Slide order, questions, answers, and timestamps are preserved for downstream analysis.',
  },
  {
    icon: Bot,
    tag: 'AI',
    title: 'Algorithmic Insight',
    desc: 'Compute audience compliance in real time and surface a 0–100 aggregate score that mirrors how your slide landed.',
  },
  {
    icon: Users,
    tag: 'Live Log',
    title: 'Participant Activity',
    desc: 'A live activity stream tracks every join and response so the host always knows the room is engaged.',
  },
  {
    icon: Lock,
    tag: 'Controls',
    title: 'Resubmission Control',
    desc: 'Lock responses or allow edits per slide. Rules are enforced server-side so participants cannot game the result.',
  },
];

const STATS = [
  { label: 'Sync latency', value: '12ms' },
  { label: 'Uptime', value: '99.998%' },
  { label: 'Avg session', value: '4:08' },
];

export default function LandingPage() {
  return (
    <Box minH="100dvh" bg="bg.canvas" color="fg">
      {/* Top nav */}
      <Flex
        as="header"
        position="sticky"
        top="0"
        zIndex="20"
        h="14"
        align="center"
        justify="space-between"
        px={{ base: '4', md: '6' }}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.panel/90"
        backdropFilter="blur(8px)"
      >
        <HStack gap="2.5">
          <Box
            w="7"
            h="7"
            borderRadius="md"
            bg="accent.solid"
            color="accent.fg"
            display="grid"
            placeItems="center"
            fontSize="sm"
            fontWeight="bold"
          >
            J
          </Box>
          <Text fontWeight="bold" fontSize="sm" letterSpacing="wide" textTransform="uppercase">
            Judge_OS
          </Text>
        </HStack>

        <HStack gap="2">
          <Link to="/join">
            <Button variant="ghost" size="sm">
              Join Session
            </Button>
          </Link>
          <a href="/api/auth/google/start">
            <Button colorPalette="green" size="sm">
              Login
            </Button>
          </a>
        </HStack>
      </Flex>

      {/* Hero */}
      <Container maxW="6xl" px={{ base: '4', md: '6' }}>
        <Grid templateColumns={{ base: '1fr', lg: '7fr 5fr' }} gap="10" pt={{ base: '12', md: '20' }} pb={{ base: '14', md: '20' }} alignItems="center">
          <Box>
            <HStack gap="3" mb="6">
              <Box
                display="inline-flex"
                alignItems="center"
                gap="2"
                px="3"
                py="1"
                borderRadius="full"
                borderWidth="1px"
                borderColor="green.solid/40"
                bg="green.solid/10"
                color="green.solid"
                fontSize="xs"
                fontWeight="medium"
                textTransform="uppercase"
                letterSpacing="wider"
              >
                <Box w="1.5" h="1.5" borderRadius="full" bg="green.solid" />
                Live platform
              </Box>
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                v2.0.4 — Stable
              </Text>
            </HStack>

            <Heading as="h1" size="3xl" fontWeight="bold" letterSpacing="tight" lineHeight="1.1" textTransform="uppercase">
              Precision evaluation
              <br />
              for every presentation.
            </Heading>

            <Text color="fg.muted" fontSize="lg" maxW="xl" mt="6">
              The Judge_OS protocol streams live audience judgment into your slide runtime. Pair every
              decision point with a vector score, watch the room reconcile in real time, and ship the
              post-mortem as structured JSON before you leave the room.
            </Text>

            <HStack gap="3" mt="8" flexWrap="wrap">
              <a href="/api/auth/google/start">
                <Button colorPalette="green" size="lg">
                  <Zap size={18} />
                  Login
                </Button>
              </a>
              <Link to="/join">
                <Button variant="outline" size="lg">
                  <Radio size={18} />
                  Join Session
                  <ArrowRight size={16} />
                </Button>
              </Link>
            </HStack>

            {/* Inline stats */}
            <SimpleGrid columns={3} maxW="xl" gap="4" mt="10">
              {STATS.map((s) => (
                <Box key={s.label} borderLeftWidth="2px" borderColor="border.subtle" pl="3">
                  <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                    {s.label}
                  </Text>
                  <Text fontSize="2xl" fontWeight="semibold" mt="1">
                    {s.value}
                  </Text>
                </Box>
              ))}
            </SimpleGrid>
          </Box>

          {/* Terminal card */}
          <Box
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="lg"
            bg="bg.surface"
            overflow="hidden"
            boxShadow="lg"
          >
            <Flex align="center" justify="space-between" px="4" py="2.5" borderBottomWidth="1px" borderColor="border.subtle">
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" fontFamily="mono">
                Console_IO
              </Text>
              <HStack gap="1.5">
                <Box w="2.5" h="2.5" borderRadius="full" bg="red.solid" />
                <Box w="2.5" h="2.5" borderRadius="full" bg="orange.solid" />
                <Box w="2.5" h="2.5" borderRadius="full" bg="green.solid" />
              </HStack>
            </Flex>
            <Box as="pre" p="5" fontSize="xs" lineHeight="1.8" fontFamily="mono" color="fg" overflowX="auto">
              {`> judge_os.boot
[OK] handshake :: edge.cdn
[OK] realtime_ws :: wss://feedback/session
[OK] durable_obj :: presentation_session
[OK] d1_schema :: 6 tables online
> judge_os.mode --live
> awaiting_presenter`}
            </Box>
            <Flex align="center" gap="2" px="4" py="2.5" borderTopWidth="1px" borderColor="border.subtle" color="green.solid" fontFamily="mono" fontSize="xs">
              <Text>{'>'}</Text>
              <Text animation="blink 1s steps(2, start) infinite">_</Text>
            </Flex>
          </Box>
        </Grid>
      </Container>

      <Separator borderColor="border.subtle" />

      {/* Features */}
      <Container maxW="6xl" px={{ base: '4', md: '6' }} py={{ base: '14', md: '20' }}>
        <Flex align="flex-end" justify="space-between" gap="4" mb="8">
          <Box>
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="1">
              [01] Core capabilities
            </Text>
            <Heading size="lg" textTransform="uppercase" letterSpacing="tight">
              What runs under the hood.
            </Heading>
          </Box>
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" display={{ base: 'none', md: 'block' }}>
            Sys.Health: Optimal · Latency: 12ms
          </Text>
        </Flex>

        <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap="4">
          {FEATURES.map((f) => (
            <Box
              key={f.title}
              borderWidth="1px"
              borderColor="border.subtle"
              borderRadius="lg"
              bg="bg.surface"
              p="6"
              transition="all 0.15s"
              _hover={{ borderColor: 'border.emphasized', transform: 'translateY(-2px)' }}
            >
              <Flex align="center" justify="space-between" mb="4">
                <Icon color="green.solid" boxSize="5">
                  <f.icon />
                </Icon>
                <Text color="fg.muted" fontSize="xs" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
                  [{f.tag}]
                </Text>
              </Flex>
              <Heading size="sm" mb="2">
                {f.title}
              </Heading>
              <Text color="fg.muted" fontSize="sm" lineHeight="relaxed">
                {f.desc}
              </Text>
            </Box>
          ))}
        </SimpleGrid>
      </Container>

      {/* Trust strip */}
      <Box borderTopWidth="1px" borderColor="border.subtle">
        <Container maxW="6xl" px={{ base: '4', md: '6' }} py="8">
          <Flex align="center" justify="space-between" gap="6" flexWrap="wrap">
            <HStack gap="2" color="fg.muted">
              <ShieldCheck size={16} />
              <Text fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                Fbk.Cert.Verified
              </Text>
            </HStack>
            <HStack gap="2" color="fg.muted">
              <CheckCircle2 size={16} />
              <Text fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                Server-side validation
              </Text>
            </HStack>
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
              Judge_OS — Internal Feedback System
            </Text>
          </Flex>
        </Container>
      </Box>
    </Box>
  );
}
