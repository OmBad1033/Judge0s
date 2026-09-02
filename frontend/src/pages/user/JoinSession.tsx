import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Field,
  FieldLabel,
  Flex,
  Heading,
  HStack,
  Icon,
  Input,
  Link,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { ArrowRight, Edit, HelpCircle, RefreshCw, StopCircle } from 'lucide-react';
import { api, ApiError } from '../../api';
import ConnectionStatus from '../../components/ConnectionStatus';

// Mobile-first participant join. Two entry points:
//   • /join           — manual code entry (empty form)
//   • /join/:code     — deep-link from QR / shared URL (code pre-filled, session pre-validated)
export default function JoinSession() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { code: codeParam } = useParams<{ code?: string }>();
  const initialCode = codeParam ?? params.get('code') ?? '';
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const trimmedCode = code.trim().toUpperCase();
  const queryClient = useQueryClient();
  const infoQuery = useQuery({
    queryKey: ['join-info', trimmedCode],
    queryFn: () => api.getJoinInfo(trimmedCode),
    enabled: trimmedCode.length >= 4,
    retry: false,
    staleTime: 30_000,
  });

  const resetCode = () => {
    setCode('');
    queryClient.removeQueries({ queryKey: ['join-info'] });
    navigate('/join', { replace: true });
  };

  useEffect(() => {
    if (codeParam) setCode(codeParam.toUpperCase());
  }, [codeParam]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api.joinSession(trimmedCode, name, email);
      localStorage.setItem('participant', JSON.stringify({ participantId: r.participantId, code: r.sessionCode }));
      navigate(`/session/${r.sessionCode}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Join failed';
      setErr(
        msg === 'SESSION_ENDED'
          ? 'This session has ended.'
          : msg === 'NOT_FOUND'
            ? 'No session with that code.'
            : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const sessionEnded = infoQuery.data?.status === 'ended';
  const sessionDraft = infoQuery.data?.status === 'draft';
  const sessionLive = infoQuery.data?.status === 'live';
  const notFound = infoQuery.error instanceof ApiError && infoQuery.error.status === 404;

  return (
    <Box minH="100dvh" bg="bg.canvas" color="fg" display="flex" flexDirection="column">
      {/* Top status strip */}
      <Box borderBottomWidth="1px" borderColor="border.subtle" bg="bg.panel">
        <Flex maxW="md" mx="auto" h="12" px="4" align="center" justify="space-between">
          <HStack gap="2" color="fg.muted">
            <Icon boxSize="4">
              <GridIcon />
            </Icon>
            <Text fontSize="xs" textTransform="uppercase" letterSpacing="wider">
              Participant Node
            </Text>
          </HStack>
          <ConnectionStatus state="connected" showLabel={false} />
        </Flex>
      </Box>

      <Flex flex="1" align="center" justify="center" px="4" py="8">
        <Box w="full" maxW="md">
          {sessionEnded && (
            <Card>
              <VStack gap="4" textAlign="center">
                <Icon color="red.solid" boxSize="10">
                  <StopCircle />
                </Icon>
                <Heading size="lg" textTransform="uppercase" letterSpacing="tight">
                  Session Ended
                </Heading>
                <Text color="fg.muted" fontSize="sm">
                  <strong>{trimmedCode}</strong> has already ended. Ask the host to start a new session.
                </Text>
                <Button variant="outline" w="full" onClick={resetCode}>
                  <RefreshCw size={16} />
                  Try Another Code
                </Button>
              </VStack>
            </Card>
          )}

          {notFound && (
            <Card>
              <VStack gap="4" textAlign="center">
                <Icon color="orange.solid" boxSize="10">
                  <HelpCircle />
                </Icon>
                <Heading size="lg" textTransform="uppercase" letterSpacing="tight">
                  Code Not Found
                </Heading>
                <Text color="fg.muted" fontSize="sm">
                  We couldn&apos;t find a session with the code <strong>{trimmedCode}</strong>. Double-check
                  the code with the host.
                </Text>
                <Button variant="outline" w="full" onClick={resetCode}>
                  <Edit size={16} />
                  Enter Code Manually
                </Button>
              </VStack>
            </Card>
          )}

          {sessionDraft && (
            <Alert.Root status="warning" mb="3" borderRadius="lg" size="sm">
              <Alert.Indicator />
              <Alert.Title>
                Session is set up but the host hasn&apos;t started yet. You can join now and wait.
              </Alert.Title>
            </Alert.Root>
          )}

          {sessionLive && (
            <Alert.Root status="success" mb="3" borderRadius="lg" size="sm">
              <Alert.Indicator />
              <Alert.Title>Session is live. Enter your details to join.</Alert.Title>
            </Alert.Root>
          )}

          {!sessionEnded && !notFound && (
            <Card>
              <Box px="6" py="5" textAlign="center" borderBottomWidth="1px" borderColor="border.subtle">
                <Heading size="md" textTransform="uppercase" letterSpacing="wide">
                  Judge_OS
                </Heading>
                <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mt="1">
                  Participant Access
                </Text>
              </Box>

              <VStack as="form" px="6" py="6" gap="5" align="stretch" onSubmit={submit}>
                <Field.Root required>
                  <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                    Participant Name
                  </FieldLabel>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name"
                    autoComplete="name"
                    size="lg"
                  />
                </Field.Root>

                <Field.Root required>
                  <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                    Email Address
                  </FieldLabel>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    inputMode="email"
                    size="lg"
                  />
                </Field.Root>

                <Field.Root required>
                  <Flex justify="space-between" align="center">
                    <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                      Session Code
                    </FieldLabel>
                    <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                      6 Characters
                    </Text>
                  </Flex>
                  <Input
                    autoComplete="off"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                      queryClient.removeQueries({ queryKey: ['join-info'] });
                    }}
                    placeholder="······"
                    inputMode="text"
                    autoCapitalize="characters"
                    maxLength={6}
                    size="lg"
                    textAlign="center"
                    fontFamily="mono"
                    fontSize="xl"
                    letterSpacing="0.3em"
                  />
                  {infoQuery.isLoading && trimmedCode.length >= 4 && (
                    <HStack gap="2" mt="2" color="fg.muted">
                      <Spinner size="xs" />
                      <Text fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                        Checking code…
                      </Text>
                    </HStack>
                  )}
                </Field.Root>

                {err && (
                  <Text color="red.solid" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                    {err}
                  </Text>
                )}

                <Button
                  type="submit"
                  colorPalette="green"
                  size="lg"
                  mt="2"
                  disabled={busy || !trimmedCode || !name || !email}
                >
                  {busy ? 'Joining…' : 'Join Session'}
                  <ArrowRight size={18} />
                </Button>
              </VStack>

              <Flex justify="space-between" px="6" py="3" borderTopWidth="1px" borderColor="border.subtle" color="fg.muted">
                <Text fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                  V2.0.4 — Stable
                </Text>
                <Text fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                  Secure Connection
                </Text>
              </Flex>
            </Card>
          )}

          <Box textAlign="center" mt="4">
            <Link href="/" color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" _hover={{ color: 'fg' }}>
              &lt; Back to Landing
            </Link>
          </Box>
        </Box>
      </Flex>
    </Box>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="6">
      {children}
    </Box>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}
