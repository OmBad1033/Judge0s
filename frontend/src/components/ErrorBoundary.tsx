import { Component, type ReactNode } from 'react';
import { Box, Button, Heading, HStack, Icon, Text, VStack } from '@chakra-ui/react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;
    if (!hasError || !error) return children;

    if (fallback) return fallback(error, this.reset);

    return (
      <Box minH="100dvh" display="grid" placeItems="center" bg="bg.canvas" color="fg" px="4">
        <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="6" maxW="md" w="full" textAlign="center">
          <VStack gap="4">
            <Icon color="red.solid" boxSize="10">
              <AlertTriangle />
            </Icon>
            <Heading size="lg" textTransform="uppercase" letterSpacing="tight">
              Something Broke
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              An unexpected error occurred. You can try again, or head back to the landing page.
            </Text>
            {error.message && (
              <Box
                as="pre"
                fontSize="xs"
                fontFamily="mono"
                color="fg.muted"
                textAlign="left"
                bg="bg.muted"
                borderWidth="1px"
                borderColor="border.subtle"
                borderRadius="md"
                p="3"
                overflowX="auto"
                w="full"
              >
                {error.message}
              </Box>
            )}
            <HStack gap="3" justify="center" mt="2" flexWrap="wrap">
              <Button colorPalette="green" onClick={this.reset}>
                <RefreshCw size={16} />
                Try Again
              </Button>
              <a href="/">
                <Button variant="outline">
                  <Home size={16} />
                  Landing Page
                </Button>
              </a>
            </HStack>
          </VStack>
        </Box>
      </Box>
    );
  }
}
