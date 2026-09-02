import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Field,
  FieldErrorText,
  FieldLabel,
  Flex,
  Heading,
  HStack,
  IconButton,
  Input,
  Link,
  Separator,
  Text,
  VStack,
} from '@chakra-ui/react';
import { ArrowLeft, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../api';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google/start';
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.adminLogin(password);
      navigate('/admin/presentations');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box minH="100dvh" display="grid" placeItems="center" bg="bg.canvas" color="fg" px="4">
      <Box w="full" maxW="md">
        <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" overflow="hidden">
          {/* Header */}
          <Box px="6" py="5" textAlign="center" borderBottomWidth="1px" borderColor="border.subtle">
            <Box
              w="10"
              h="10"
              mx="auto"
              mb="3"
              borderRadius="lg"
              bg="accent.solid"
              color="accent.fg"
              display="grid"
              placeItems="center"
              fontSize="lg"
              fontWeight="bold"
            >
              J
            </Box>
            <Heading size="md" textTransform="uppercase" letterSpacing="wide">
              Judge_OS
            </Heading>
            <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mt="1">
              Admin Authentication
            </Text>
          </Box>

          <VStack px="6" py="6" gap="5" align="stretch">
            {/* Primary Google OAuth Login */}
            <Button size="lg" onClick={handleGoogleLogin}>
              <GoogleIcon />
              Login with Google
            </Button>

            <Flex align="center" gap="3">
              <Separator flex="1" borderColor="border.subtle" />
              <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                or
              </Text>
              <Separator flex="1" borderColor="border.subtle" />
            </Flex>

            {/* Legacy fallback */}
            <Button variant="ghost" size="sm" onClick={() => setShowLegacy(!showLegacy)}>
              {showLegacy ? '[-] Hide System Key' : '[+] Enter System Key'}
            </Button>

            {showLegacy && (
              <VStack as="form" gap="4" align="stretch" onSubmit={submit}>
                <Field.Root required invalid={!!err}>
                  <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                    Auth Key
                  </FieldLabel>
                  <Flex position="relative" align="center">
                    <Input
                      type={show ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter system auth key"
                      size="lg"
                      pr="10"
                      required
                    />
                    <IconButton
                      aria-label={show ? 'Hide password' : 'Show password'}
                      variant="ghost"
                      size="sm"
                      position="absolute"
                      right="1.5"
                      onClick={() => setShow((s) => !s)}
                    >
                      {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </IconButton>
                  </Flex>
                  {err && (
                    <FieldErrorText fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                      {err}
                    </FieldErrorText>
                  )}
                </Field.Root>

                <Button type="submit" variant="outline" size="lg" disabled={busy}>
                  {busy ? 'Authenticating…' : 'Submit Key'}
                </Button>
              </VStack>
            )}
          </VStack>

          {/* Footer */}
          <Flex align="center" justify="center" gap="2" px="6" py="3" borderTopWidth="1px" borderColor="border.subtle" color="fg.muted">
            <ShieldCheck size={14} />
            <Text fontSize="xs" textTransform="uppercase" letterSpacing="wider">
              Secure Connection Established · v2.0.4
            </Text>
          </Flex>
        </Box>

        <Box textAlign="center" mt="4">
          <Link href="/" color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" _hover={{ color: 'fg' }}>
            <HStack gap="1" justify="center">
              <ArrowLeft size={14} />
              <span>Back to Landing</span>
            </HStack>
          </Link>
        </Box>
      </Box>
    </Box>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}
