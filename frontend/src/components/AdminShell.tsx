import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import {
  Avatar,
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  IconButton,
  Separator,
  Spinner,
  Text,
  Tooltip,
} from '@chakra-ui/react';
import {
  BarChart2,
  Bell,
  LayoutGrid,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Sparkles,
} from 'lucide-react';
import { api } from '../api';
import * as Sidebar from '../components/ui/sidebar/sidebar';
import { useSidebar } from '../components/ui/sidebar/sidebar.context';

const NAV = [
  { to: '/admin/presentations', label: 'Library', icon: <LayoutGrid size={18} />, end: true },
  { to: '/admin/presentations?new=1', label: 'New Presentation', icon: <Plus size={18} />, end: false },
];

export default function AdminShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<'loading' | 'ok' | 'unauth'>('loading');
  const [userName, setUserName] = useState<string | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminMe()
      .then((res) => {
        setUserName(res.user?.name ?? null);
        setUserAvatar(res.user?.avatarUrl ?? null);
        setState('ok');
      })
      .catch(() => setState('unauth'));
  }, []);

  useEffect(() => {
    if (state === 'unauth') navigate('/admin/login', { replace: true });
  }, [state, navigate]);

  const logout = async () => {
    await api.adminLogout().catch(() => {});
    navigate('/admin/login');
  };

  if (state !== 'ok') {
    return (
      <Box h="100dvh" display="grid" placeItems="center">
        <HStack gap="3" color="fg.muted">
          <Spinner size="sm" />
          <Text fontSize="sm" fontWeight="medium">
            Authenticating…
          </Text>
        </HStack>
      </Box>
    );
  }

  return (
    <Sidebar.Provider defaultOpen={true} mode="collapsible">
      <Shell userName={userName} userAvatar={userAvatar} onLogout={logout}>
        <Outlet />
      </Shell>
    </Sidebar.Provider>
  );
}

function Shell({
  userName,
  userAvatar,
  onLogout,
  children,
}: {
  userName: string | null;
  userAvatar: string | null;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const sidebar = useSidebar();
  const open = sidebar.open;

  return (
    <Box minH="100dvh" w="full">
      {/* Fixed sidebar — never affects document flow. */}
      <Sidebar.Root
        width="264px"
        minWidth="264px"
        position="fixed"
        insetY="0"
        left="0"
        zIndex="30"
        display="flex"
        flexDirection="column"
        bg="bg.surface"
        borderRightWidth="1px"
        borderColor="border.subtle"
        transform={open ? 'translateX(0)' : 'translateX(-100%)'}
        transition="transform 0.2s ease"
      >
        <Sidebar.Header>
          <Flex align="center" justify="space-between" gap="1" minH="14" pl="2" pr="1">
            <HStack gap="2.5" minW="0">
              <Box
                w="8"
                h="8"
                borderRadius="lg"
                bg="accent.solid"
                color="accent.fg"
                display="grid"
                placeItems="center"
                fontSize="md"
                fontWeight="bold"
                flexShrink="0"
              >
                J
              </Box>
              <Box lineHeight="1.1" minW="0">
                <Text fontWeight="bold" fontSize="sm" letterSpacing="wide" textTransform="uppercase" truncate>
                  Judge_OS
                </Text>
                <Text color="fg.muted" fontSize="xs">
                  Live Feedback Protocol
                </Text>
              </Box>
            </HStack>
            <IconButton
              aria-label="Toggle sidebar"
              variant="ghost"
              size="sm"
              color="fg.muted"
              flexShrink="0"
              onClick={() => sidebar.toggle()}
            >
              <PanelLeftClose size={18} />
            </IconButton>
          </Flex>
        </Sidebar.Header>

        <Sidebar.Body>
          <Sidebar.Group>
            <Sidebar.GroupContent>
              {NAV.map((item) => {
                const active = item.end
                  ? location.pathname === item.to
                  : location.pathname.startsWith(item.to.split('?')[0]);
                return (
                  <Sidebar.NavItem key={item.to} variant="muted" size="md">
                    <Sidebar.NavButton onClick={() => navigate(item.to)} active={active}>
                      {item.icon}
                      {item.label}
                    </Sidebar.NavButton>
                  </Sidebar.NavItem>
                );
              })}
            </Sidebar.GroupContent>
          </Sidebar.Group>

          <Separator my="4" />

          <Sidebar.Group>
            <Sidebar.GroupTitle>Reports</Sidebar.GroupTitle>
            <Sidebar.GroupContent>
              <Sidebar.NavItem variant="muted" size="md">
                <Sidebar.NavButton onClick={() => navigate('/admin/presentations')}>
                  <BarChart2 size={18} />
                  Analytics
                </Sidebar.NavButton>
              </Sidebar.NavItem>
            </Sidebar.GroupContent>
          </Sidebar.Group>
        </Sidebar.Body>

        <Sidebar.Footer>
          <Flex align="center" justify="space-between" gap="2" px="2" py="3">
            <HStack gap="2.5" minW="0">
              <Avatar.Root size="sm">
                <Avatar.Fallback name={userName ?? 'Admin'} />
                {userAvatar ? <Avatar.Image src={userAvatar} referrerPolicy="no-referrer" /> : null}
              </Avatar.Root>
              <Box lineHeight="1.1" minW="0">
                <Text fontSize="sm" fontWeight="medium" truncate>
                  {userName ?? 'Admin'}
                </Text>
                <Text color="fg.muted" fontSize="xs">
                  Administrator
                </Text>
              </Box>
            </HStack>
            <IconButton aria-label="Logout" variant="ghost" size="sm" color="fg.muted" onClick={onLogout}>
              <LogOut size={16} />
            </IconButton>
          </Flex>
        </Sidebar.Footer>
      </Sidebar.Root>

      {/* Content — offset by sidebar width when open. */}
      <Box
        minH="100dvh"
        display="flex"
        flexDirection="column"
        marginLeft={{ base: '0', md: open ? '264px' : '0' }}
        transition="margin-left 0.2s ease"
      >
        <TopBar userName={userName} userAvatar={userAvatar} onLogout={onLogout} />

        <Box as="main" flex="1" minW="0" px={{ base: '4', md: '6' }} py="6" maxW="1280px" w="full" mx="auto">
          {children}
        </Box>
      </Box>

      {/* Expand button — only visible when the sidebar is collapsed so it can
          always be reopened. Sits at the top-left corner of the content. */}
      {!open && (
        <IconButton
          aria-label="Open sidebar"
          variant="outline"
          size="sm"
          position="fixed"
          top="3"
          left="3"
          zIndex="40"
          bg="bg.panel"
          boxShadow="sm"
          onClick={() => sidebar.toggle()}
        >
          <PanelLeft size={18} />
        </IconButton>
      )}
    </Box>
  );
}

function TopBar({
  userName,
  userAvatar,
  onLogout,
}: {
  userName: string | null;
  userAvatar: string | null;
  onLogout: () => void;
}) {
  return (
    <Flex
      as="header"
      position="sticky"
      top="0"
      zIndex="20"
      h="14"
      align="center"
      justify="space-between"
      borderBottomWidth="1px"
      borderColor="border.subtle"
      bg="bg.panel/90"
      backdropFilter="blur(8px)"
    >
      {/* Spacer reserved for the toggle button on mobile (where it would
          otherwise overlap the header content). */}
      <Box w="12" display={{ base: 'block', md: 'none' }} flexShrink="0" />

      <HStack gap="2" display={{ base: 'flex', md: 'none' }} flex="1">
        <Heading size="sm" textTransform="uppercase" letterSpacing="wide">
          Judge_OS
        </Heading>
      </HStack>

      <HStack gap="2" ml="auto" pr={{ base: '4', md: '6' }}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <IconButton aria-label="Notifications" variant="ghost" color="fg.muted" disabled>
              <Bell size={18} />
            </IconButton>
          </Tooltip.Trigger>
          <Tooltip.Positioner>
            <Tooltip.Content>Coming soon</Tooltip.Content>
          </Tooltip.Positioner>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <IconButton aria-label="AI assistant" variant="ghost" color="fg.muted" disabled>
              <Sparkles size={18} />
            </IconButton>
          </Tooltip.Trigger>
          <Tooltip.Positioner>
            <Tooltip.Content>Coming soon</Tooltip.Content>
          </Tooltip.Positioner>
        </Tooltip.Root>

        <Separator orientation="vertical" h="6" />

        <HStack gap="2">
          <Avatar.Root size="sm">
            <Avatar.Fallback name={userName ?? 'Admin'} />
            {userAvatar ? <Avatar.Image src={userAvatar} referrerPolicy="no-referrer" /> : null}
          </Avatar.Root>
          <Box display={{ base: 'none', md: 'block' }} lineHeight="1.1">
            <Text fontSize="sm" fontWeight="medium">
              {userName ?? 'Admin'}
            </Text>
            <Text color="fg.muted" fontSize="xs">
              Administrator
            </Text>
          </Box>
        </HStack>

        <Button
          variant="ghost"
          size="sm"
          color="fg.muted"
          onClick={onLogout}
          display={{ base: 'none', md: 'inline-flex' }}
        >
          <LogOut size={16} />
          Logout
        </Button>
      </HStack>
    </Flex>
  );
}
