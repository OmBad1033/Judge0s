import { Link } from 'react-router-dom';
import { Box, Button, Heading, HStack, Icon, Text, VStack } from '@chakra-ui/react';
import { CloudOff, Home, ScanLine } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <Box minH="100dvh" display="grid" placeItems="center" bg="bg.canvas" color="fg" px="4">
      <Box
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="lg"
        bg="bg.surface"
        p="8"
        maxW="md"
        w="full"
        textAlign="center"
      >
        <VStack gap="4">
          <Icon color="fg.muted" boxSize="10">
            <CloudOff />
          </Icon>
          <Heading size="lg" textTransform="uppercase" letterSpacing="tight">
            404 — Not Found
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            The page you tried to reach doesn&apos;t exist. If you scanned a code, double-check it — or
            jump straight to the join screen.
          </Text>
          <HStack gap="3" justify="center" mt="2" flexWrap="wrap">
            <Link to="/join">
              <Button colorPalette="green">
                <ScanLine size={16} />
                Join Session
              </Button>
            </Link>
            <Link to="/">
              <Button variant="outline">
                <Home size={16} />
                Landing Page
              </Button>
            </Link>
          </HStack>
        </VStack>
      </Box>
    </Box>
  );
}
