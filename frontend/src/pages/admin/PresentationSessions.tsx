import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Breadcrumb,
  BreadcrumbCurrentLink,
  BreadcrumbLink,
  Button,
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
  Heading,
  HStack,
  Icon,
  Input,
  Table,
  Text,
  VStack,
} from '@chakra-ui/react';
import { AlertTriangle, BarChart3, ChevronRight, Edit, Play, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api';
import type { Presentation, Session } from '../../types';
import { useToast } from '../../lib/toast';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyStateCard } from '../../components/ui/empty-state';
import { StatusBadge } from '../../components/ui/status-badge';
import { SkeletonRows } from '../../components/ui/skeleton';

export default function PresentationSessions() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [sessionName, setSessionName] = useState('');

  const presQ = useQuery({
    queryKey: ['presentation', id],
    queryFn: () => api.getPresentation(id),
    enabled: !!id,
  });

  const sessionsQ = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => api.listSessions(id).then((r) => r.sessions),
    enabled: !!id,
    refetchInterval: 15_000,
  });

  const startMut = useMutation({
    mutationFn: () => api.createSession(id, sessionName.trim() || undefined),
    onSuccess: (s) => {
      toast.push('success', 'Session started');
      queryClient.invalidateQueries({ queryKey: ['sessions', id] });
      queryClient.invalidateQueries({ queryKey: ['presentations'] });
      setShowNamePrompt(false);
      setSessionName('');
      navigate(`/admin/sessions/${s.sessionCode}`);
    },
    onError: (e) => toast.push('error', e instanceof ApiError ? e.message : 'Failed to start session'),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.deletePresentation(id),
    onSuccess: () => {
      toast.push('success', 'Presentation and all its data deleted');
      queryClient.invalidateQueries({ queryKey: ['presentations'] });
      navigate('/admin/presentations');
    },
    onError: (e) => {
      toast.push('error', e instanceof ApiError ? e.message : 'Failed to delete presentation');
      setConfirmDelete(false);
    },
  });

  if (presQ.isLoading) {
    return (
      <VStack gap="4" align="stretch">
        <SkeletonRows rows={2} />
      </VStack>
    );
  }

  if (presQ.isError || !presQ.data) {
    return (
      <Alert.Root status="error" borderRadius="lg">
        <Alert.Indicator />
        <Alert.Title>Presentation not found</Alert.Title>
      </Alert.Root>
    );
  }

  const presentation = presQ.data;
  const sessions = sessionsQ.data ?? [];
  const latestEnded = [...sessions]
    .filter((s) => s.status === 'ended')
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))[0];

  return (
    <VStack gap="4" align="stretch">
      {/* Breadcrumb */}
      <Breadcrumb.Root size="sm">
        <Breadcrumb.List>
          <Breadcrumb.Item>
            <BreadcrumbLink onClick={() => navigate('/admin/presentations')} cursor="pointer">
              Library
            </BreadcrumbLink>
          </Breadcrumb.Item>
          <Breadcrumb.Separator>
            <ChevronRight size={14} />
          </Breadcrumb.Separator>
          <Breadcrumb.Item>
            <BreadcrumbCurrentLink>{presentation.title}</BreadcrumbCurrentLink>
          </Breadcrumb.Item>
        </Breadcrumb.List>
      </Breadcrumb.Root>

      {/* Header + actions */}
      <PageHeader
        eyebrow="Presentation"
        title={presentation.title}
        description={`${presentation.slideCount} Slides · ${sessions.length} Session${sessions.length === 1 ? '' : 's'}`}
        actions={
          <>
            <Button variant="outline" colorPalette="red" onClick={() => setConfirmDelete(true)} disabled={deleteMut.isPending}>
              <Trash2 size={16} />
              Delete
            </Button>
            <Link to={`/admin/presentations/${presentation.id}/configure`}>
              <Button variant="outline">
                <Edit size={16} />
                Configure
              </Button>
            </Link>
            {latestEnded && (
              <Link to={`/admin/sessions/${latestEnded.sessionCode}/analytics`}>
                <Button variant="outline">
                  <BarChart3 size={16} />
                  Analytics
                </Button>
              </Link>
            )}
            <Button colorPalette="green" onClick={() => setShowNamePrompt(true)} disabled={startMut.isPending}>
              <Play size={16} />
              Start Session
            </Button>
          </>
        }
      />

      {sessionsQ.isLoading ? (
        <SkeletonRows rows={3} />
      ) : sessions.length === 0 ? (
        <EmptyStateCard
          icon={<Icon color="fg.muted" boxSize="10"><RadioIcon /></Icon>}
          title="No sessions yet"
          description="Start your first session to invite participants."
        >
          <Button colorPalette="green" onClick={() => setShowNamePrompt(true)} disabled={startMut.isPending}>
            <Play size={16} />
            Start Session
          </Button>
        </EmptyStateCard>
      ) : (
        <SessionsTable sessions={sessions} presentation={presentation} />
      )}

      {/* Start session dialog */}
      <Dialog.Root open={showNamePrompt} onOpenChange={(e) => !startMut.isPending && e.open === false && setShowNamePrompt(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name this session?</DialogTitle>
            <DialogCloseTrigger disabled={startMut.isPending} />
          </DialogHeader>
          <DialogBody>
            <VStack as="form" gap="4" align="stretch" onSubmit={(e) => { e.preventDefault(); startMut.mutate(); }}>
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
                <Button variant="outline" onClick={() => setShowNamePrompt(false)} disabled={startMut.isPending}>
                  Cancel
                </Button>
                <Button type="submit" colorPalette="green" disabled={startMut.isPending}>
                  {startMut.isPending ? 'Starting…' : 'Start Session'}
                </Button>
              </HStack>
            </VStack>
          </DialogBody>
        </DialogContent>
      </Dialog.Root>

      {/* Delete confirmation */}
      <Dialog.Root open={confirmDelete} onOpenChange={(e) => !deleteMut.isPending && e.open === false && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle color="red.solid">Delete Presentation?</DialogTitle>
            <DialogCloseTrigger disabled={deleteMut.isPending} />
          </DialogHeader>
          <DialogBody>
            <VStack gap="4" align="stretch">
              <HStack gap="2" color="red.solid">
                <AlertTriangle size={18} />
                <Text fontSize="sm">
                  This permanently removes <strong>{presentation.title}</strong> and all{' '}
                  <strong>{sessions.length} session{sessions.length === 1 ? '' : 's'}</strong> associated
                  with it, including every participant response and the uploaded file.
                </Text>
              </HStack>
              <Text color="red.solid" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                This action cannot be undone.
              </Text>
            </VStack>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleteMut.isPending}>
              Cancel
            </Button>
            <Button colorPalette="red" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? 'Deleting…' : 'Delete Everything'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog.Root>
    </VStack>
  );
}

function SessionsTable({ sessions, presentation }: { sessions: Session[]; presentation: Presentation }) {
  const navigate = useNavigate();
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="lg" overflow="hidden" bg="bg.surface">
      <Table.Root size="sm" interactive>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader px="4">Name</Table.ColumnHeader>
            <Table.ColumnHeader>Code</Table.ColumnHeader>
            <Table.ColumnHeader>Status</Table.ColumnHeader>
            <Table.ColumnHeader display={{ base: 'none', sm: 'table-cell' }}>Slide</Table.ColumnHeader>
            <Table.ColumnHeader display={{ base: 'none', md: 'table-cell' }}>Created</Table.ColumnHeader>
            <Table.ColumnHeader display={{ base: 'none', md: 'table-cell' }}>Started</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="right" pr="4">Open</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {sessions.map((s) => {
            const target =
              s.status === 'ended'
                ? `/admin/sessions/${s.sessionCode}/results`
                : `/admin/sessions/${s.sessionCode}`;
            const slideLabel =
              s.status === 'ended' || s.status === 'draft'
                ? '—'
                : `${s.currentSlideNumber ?? 0} / ${presentation.slideCount}`;
            return (
              <Table.Row
                key={s.id}
                onClick={() => navigate(target)}
                cursor="pointer"
                _hover={{ bg: 'bg.muted' }}
              >
                <Table.Cell px="4" fontWeight="medium">
                  {s.name || s.sessionCode}
                </Table.Cell>
                <Table.Cell color="fg.muted" fontFamily="mono">
                  {s.sessionCode}
                </Table.Cell>
                <Table.Cell>
                  <StatusBadge status={s.status} />
                </Table.Cell>
                <Table.Cell color="fg.muted" display={{ base: 'none', sm: 'table-cell' }}>
                  {slideLabel}
                </Table.Cell>
                <Table.Cell color="fg.muted" display={{ base: 'none', md: 'table-cell' }}>
                  {formatTime(s.createdAt)}
                </Table.Cell>
                <Table.Cell color="fg.muted" display={{ base: 'none', md: 'table-cell' }}>
                  {s.startedAt ? formatTime(s.startedAt) : '—'}
                </Table.Cell>
                <Table.Cell textAlign="right" pr="4">
                  <HStack gap="1" justify="flex-end">
                    <Link
                      to={`/admin/sessions/${s.sessionCode}/analytics`}
                      onClick={(e) => e.stopPropagation()}
                      title="View analytics"
                    >
                      <Button variant="ghost" size="xs" aria-label="Analytics">
                        <BarChart3 size={14} />
                      </Button>
                    </Link>
                    <ChevronRight size={16} color="var(--chakra-colors-fg-muted)" />
                  </HStack>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function RadioIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
    </svg>
  );
}
