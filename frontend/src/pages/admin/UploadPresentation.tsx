import { useRef, useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
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
  Grid,
  Heading,
  HStack,
  Icon,
  Input,
  SimpleGrid,
  Text,
  VStack,
} from '@chakra-ui/react';
import { ArrowRight, FileText, Plus, UploadCloud } from 'lucide-react';
import { api, ApiError } from '../../api';
import type { PresentationSummary } from '../../types';
import { useToast } from '../../lib/toast';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyStateCard } from '../../components/ui/empty-state';
import { StatusBadge } from '../../components/ui/status-badge';
import { SkeletonGrid } from '../../components/ui/skeleton';

export default function UploadPresentation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [slideCount, setSlideCount] = useState('5');
  const [file, setFile] = useState<File | null>(null);
  const [uploadErr, setUploadErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Deep link from the sidebar "New Presentation" item (?new=1) opens the
  // upload dialog on arrival.
  useEffect(() => {
    if (searchParams.get('new') === '1') setOpen(true);
  }, [searchParams]);

  const isPdf = file ? /\.pdf$/i.test(file.name) : false;

  const listQ = useQuery({
    queryKey: ['presentations'],
    queryFn: () => api.listPresentations().then((r) => r.presentations),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.createPresentation({
        title,
        ...(isPdf ? {} : { slideCount: Number(slideCount) }),
        file: file!,
      }),
    onSuccess: (p) => {
      toast.push('success', 'Presentation uploaded');
      queryClient.invalidateQueries({ queryKey: ['presentations'] });
      setOpen(false);
      setTitle('');
      setSlideCount('5');
      setFile(null);
      navigate(`/admin/presentations/${p.id}/configure`);
    },
    onError: (e) => setUploadErr(e instanceof ApiError ? e.message : 'Upload failed'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setUploadErr('Select a .pptx or .pdf file');
      return;
    }
    setUploadErr('');
    createMut.mutate();
  };

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Presentation Library"
        description="Upload, configure, and run live feedback sessions. PDFs are auto-extracted."
        actions={
          <Button colorPalette="green" onClick={() => setOpen(true)}>
            <Plus size={16} />
            Upload
          </Button>
        }
      />

      {listQ.isLoading ? (
        <SkeletonGrid />
      ) : listQ.isError ? (
        <Box color="red.solid" fontSize="sm">
          Failed to load presentations
        </Box>
      ) : (listQ.data ?? []).length === 0 ? (
        <EmptyStateCard
          icon={<Icon color="fg.muted" boxSize="10"><FileText /></Icon>}
          title="No presentations yet"
          description="Upload your first .pptx or .pdf to begin a feedback session."
        >
          <Button colorPalette="green" onClick={() => setOpen(true)}>
            <Plus size={16} />
            Upload
          </Button>
        </EmptyStateCard>
      ) : (
        <PresentationGrid items={listQ.data!} />
      )}

      <UploadModal
        open={open}
        title={title}
        slideCount={slideCount}
        file={file}
        isPdf={isPdf}
        busy={createMut.isPending}
        err={uploadErr}
        fileRef={fileRef}
        onTitle={setTitle}
        onSlideCount={setSlideCount}
        onFile={setFile}
        onClose={() => {
          if (createMut.isPending) return;
          setOpen(false);
          setUploadErr('');
        }}
        onSubmit={submit}
      />
    </>
  );
}

function PresentationGrid({ items }: { items: PresentationSummary[] }) {
  const navigate = useNavigate();
  return (
    <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap="4">
      {items.map((p) => (
        <Box
          key={p.id}
          as="button"
          onClick={() => navigate(`/admin/presentations/${p.id}/sessions`)}
          borderWidth="1px"
          borderColor="border.subtle"
          borderRadius="lg"
          bg="bg.surface"
          p="5"
          textAlign="left"
          transition="all 0.15s"
          _hover={{ borderColor: 'border.emphasized', transform: 'translateY(-2px)', boxShadow: 'md' }}
          _focusVisible={{ outline: '2px solid', outlineColor: 'border.emphasized' }}
          cursor="pointer"
          display="flex"
          flexDirection="column"
          minH="180px"
        >
          <Flex align="flex-start" justify="space-between" gap="2" mb="3">
            <Text color="green.solid" fontSize="xs" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
              [File]
            </Text>
            {p.latestSession && <StatusBadge status={p.latestSession.status} />}
          </Flex>
          <Heading size="sm" mb="1" truncate>
            {p.title}
          </Heading>
          <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="1">
            {p.slideCount} Slides · {p.configuredSlides} Configured
          </Text>
          <Text color="fg.muted" fontSize="xs" truncate mb="1">
            Src: {p.originalFilename}
          </Text>
          {p.latestSession && (
            <Text color="fg.muted" fontSize="xs" truncate mb="1">
              Latest: {p.latestSession.sessionCode}
            </Text>
          )}
          <HStack gap="1" mt="auto" pt="4" color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
            <span>View Sessions</span>
            <ArrowRight size={14} />
          </HStack>
        </Box>
      ))}
    </SimpleGrid>
  );
}

function UploadModal({
  open,
  title,
  slideCount,
  file,
  isPdf,
  busy,
  err,
  fileRef,
  onTitle,
  onSlideCount,
  onFile,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  slideCount: string;
  file: File | null;
  isPdf: boolean;
  busy: boolean;
  err: string;
  fileRef: React.RefObject<HTMLInputElement>;
  onTitle: (v: string) => void;
  onSlideCount: (v: string) => void;
  onFile: (f: File | null) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const showSlideCount = file !== null && !isPdf;
  return (
    <Dialog.Root open={open} onOpenChange={(e) => !busy && e.open === false && onClose()} size="lg">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Presentation</DialogTitle>
          <DialogCloseTrigger disabled={busy} />
        </DialogHeader>
        <DialogBody>
          <VStack as="form" gap="4" align="stretch" onSubmit={onSubmit}>
            <Field.Root required>
              <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                Title
              </FieldLabel>
              <Input
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                placeholder="e.g. Q3 Strategy Review"
                required
                size="lg"
              />
            </Field.Root>

            <Button
              type="button"
              variant="outline"
              borderStyle="dashed"
              onClick={() => fileRef.current?.click()}
              h="32"
              flexDirection="column"
              gap="2"
              cursor="pointer"
            >
              <Icon color="fg.muted" boxSize="8">
                <UploadCloud />
              </Icon>
              <Text fontSize="sm" color={file ? 'green.solid' : 'fg.muted'} fontFamily="mono">
                {file ? `> ${file.name}` : '> Drop .pptx or .pdf here or click to browse'}
              </Text>
              <input
                ref={fileRef}
                type="file"
                accept=".pptx,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                required
                disabled={busy}
              />
            </Button>

            {showSlideCount && (
              <Field.Root required>
                <FieldLabel fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                  Slide Count
                </FieldLabel>
                <Input
                  type="number"
                  min="1"
                  value={slideCount}
                  onChange={(e) => onSlideCount(e.target.value)}
                  required
                  size="lg"
                />
              </Field.Root>
            )}

            {err && (
              <Text color="red.solid" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                {err}
              </Text>
            )}

            <Button type="submit" colorPalette="green" size="lg" mt="2" disabled={busy}>
              {busy ? 'Uploading…' : 'Upload & Configure'}
            </Button>
          </VStack>
        </DialogBody>
        <DialogFooter />
      </DialogContent>
    </Dialog.Root>
  );
}
