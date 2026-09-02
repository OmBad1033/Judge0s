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
  Heading,
  HStack,
  Icon,
  Input,
  SimpleGrid,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { ArrowRight, FileText, Plus, UploadCloud } from 'lucide-react';
import { api, ApiError } from '../../api';
import type { PresentationSummary } from '../../types';
import { useToast } from '../../lib/toast';
import { countSlidesInFile } from '../../lib/slideCount';
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
  const [file, setFile] = useState<File | null>(null);
  const [fileSlideCount, setFileSlideCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Deep link from the sidebar "New Presentation" item (?new=1) opens the
  // upload dialog on arrival.
  useEffect(() => {
    if (searchParams.get('new') === '1') setOpen(true);
  }, [searchParams]);

  const isPdf = file ? /\.pdf$/i.test(file.name) : false;

  const onFileChosen = async (f: File | null) => {
    setFile(f);
    setUploadErr('');
    if (f && /\.pptx$/i.test(f.name)) {
      // Derive the deck size from the file itself — the admin never types it.
      setCounting(true);
      setFileSlideCount(null);
      try {
        setFileSlideCount(await countSlidesInFile(f));
      } finally {
        setCounting(false);
      }
    } else {
      setFileSlideCount(null);
    }
  };

  const listQ = useQuery({
    queryKey: ['presentations'],
    queryFn: () => api.listPresentations().then((r) => r.presentations),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.createPresentation({
        title,
        file: file!,
      }),
    onSuccess: (p) => {
      toast.push('success', 'Presentation uploaded');
      queryClient.invalidateQueries({ queryKey: ['presentations'] });
      setOpen(false);
      setTitle('');
      setFile(null);
      setFileSlideCount(null);
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
        file={file}
        isPdf={isPdf}
        counting={counting}
        fileSlideCount={fileSlideCount}
        busy={createMut.isPending}
        err={uploadErr}
        fileRef={fileRef}
        onTitle={setTitle}
        onFile={onFileChosen}
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
  file,
  isPdf,
  counting,
  fileSlideCount,
  busy,
  err,
  fileRef,
  onTitle,
  onFile,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  file: File | null;
  isPdf: boolean;
  counting: boolean;
  fileSlideCount: number | null;
  busy: boolean;
  err: string;
  fileRef: React.RefObject<HTMLInputElement>;
  onTitle: (v: string) => void;
  onFile: (f: File | null) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
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

            {file && (
              <Text color="fg.muted" fontSize="sm">
                {counting ? (
                  <HStack gap="2">
                    <Spinner size="sm" />
                    <span>Reading slide count…</span>
                  </HStack>
                ) : isPdf ? (
                  'PDF — slide count is read from the file on upload.'
                ) : fileSlideCount ? (
                  `${fileSlideCount} slide${fileSlideCount === 1 ? '' : 's'} detected`
                ) : (
                  'Could not read slide count — it will be detected after upload.'
                )}
              </Text>
            )}

            {err && (
              <Text color="red.solid" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                {err}
              </Text>
            )}

            <Button type="submit" colorPalette="green" size="lg" mt="2" disabled={busy || counting}>
              {busy ? 'Uploading…' : 'Upload & Configure'}
            </Button>
          </VStack>
        </DialogBody>
        <DialogFooter />
      </DialogContent>
    </Dialog.Root>
  );
}
