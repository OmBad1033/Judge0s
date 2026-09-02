import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Input,
  SimpleGrid,
  Table,
  Tag,
  Text,
  VStack,
} from '@chakra-ui/react';
import { ArrowLeft, BarChart3, Download, Inbox, Search, Sparkles } from 'lucide-react';
import { api } from '../../api';
import type { ExportData } from '../../types';
import { totalEvaluations, totalNodesProcessed, payloadScore, aiCompliance } from '../../lib/metrics';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard } from '../../components/ui/stat-card';
import { EmptyStateCard } from '../../components/ui/empty-state';

function toCSV(data: ExportData): string {
  const headers = ['Slide', 'Name', 'Email', 'Question', 'Type', 'Response', 'Submitted'];
  const rows = data.feedback.map((f) => [
    String(f.slideNumber),
    JSON.stringify(f.user.name),
    JSON.stringify(f.user.email),
    JSON.stringify(f.question ?? ''),
    f.feedbackType,
    JSON.stringify(f.response ?? ''),
    f.submittedAt,
  ]);
  const dHeaders = ['Slide', 'Name', 'Email', 'Question', 'Type', 'Response', 'Submitted'];
  const dRows = data.defaultFeedback.map((f) => [
    String(f.slideNumber),
    JSON.stringify(f.user.name),
    JSON.stringify(f.user.email),
    JSON.stringify(f.question),
    f.questionType,
    JSON.stringify(f.response ?? ''),
    f.submittedAt,
  ]);
  return [headers, ...rows, dHeaders, ...dRows].map((r) => r.join(',')).join('\n');
}

export default function SessionResults() {
  const { code } = useParams();
  const [data, setData] = useState<ExportData | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'complete'>('all');

  useEffect(() => {
    if (!code) return;
    api.exportSession(code).then(setData).catch(() => setData(null));
  }, [code]);

  const downloadCSV = () => {
    if (!data) return;
    const blob = new Blob([toCSV(data)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feedback-${data.session.code}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = search.toLowerCase();
    return data.feedback.filter((f) => {
      if (filter === 'complete' && !f.response) return false;
      if (!term) return true;
      return (
        f.user.name.toLowerCase().includes(term) ||
        f.user.email.toLowerCase().includes(term) ||
        (f.question?.toLowerCase().includes(term) ?? false) ||
        (f.response?.toLowerCase().includes(term) ?? false)
      );
    });
  }, [data, search, filter]);

  if (!data) {
    return (
      <Box textAlign="center" py="10" color="fg.muted" fontSize="sm">
        Loading export…
      </Box>
    );
  }

  const totalEvals = totalEvaluations(data);
  const payload = payloadScore([...data.feedback, ...data.defaultFeedback]);
  const ai = aiCompliance([...data.feedback, ...data.defaultFeedback]);
  const nodes = totalNodesProcessed(data);

  return (
    <VStack gap="6" align="stretch">
      <PageHeader
        eyebrow="Results"
        title="Results & Export"
        description={`${data.session.presentation} · Code: ${data.session.code} · ${data.session.status}`}
        actions={
          <>
            <Button variant="outline" onClick={downloadCSV}>
              <Download size={16} />
              Export CSV
            </Button>
            <Link to={`/admin/sessions/${code}/analytics`}>
              <Button colorPalette="green">
                <Sparkles size={16} />
                Analysis
              </Button>
            </Link>
            <Link to={`/admin/sessions/${code}`}>
              <Button variant="outline">
                <ArrowLeft size={16} />
                Back
              </Button>
            </Link>
          </>
        }
      />

      {/* KPI scorecards */}
      <SimpleGrid columns={{ base: 2, lg: 4 }} gap="4">
        <StatCard label="Total Evaluations" value={totalEvals.toLocaleString()} sub="/ 100" />
        <StatCard label="Payload Score" value={payload.toFixed(1)} sub="/ 100" icon={<BarChart3 size={16} />} />
        <StatCard label="AI Compliance" value={`${ai.toFixed(1)}%`} icon={<Sparkles size={16} />} />
        <StatCard label="Total Nodes" value={nodes.toLocaleString()} sub="processed" icon={<Inbox size={16} />} />
      </SimpleGrid>

      {/* Filter + search */}
      <Flex gap="2" flexWrap="wrap" align="center">
        <Button
          size="sm"
          variant={filter === 'all' ? 'solid' : 'outline'}
          colorPalette={filter === 'all' ? 'green' : undefined}
          onClick={() => setFilter('all')}
        >
          All
        </Button>
        <Button
          size="sm"
          variant={filter === 'complete' ? 'solid' : 'outline'}
          colorPalette={filter === 'complete' ? 'green' : undefined}
          onClick={() => setFilter('complete')}
        >
          Complete
        </Button>
        <Box flex="1" />
        <Box position="relative" w={{ base: 'full', sm: 'auto' }}>
          <Box position="absolute" left="2.5" top="1/2" transform="translateY(-50%)" color="fg.muted" pointerEvents="none">
            <Search size={16} />
          </Box>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search participant or response…"
            pl="9"
            w={{ base: 'full', sm: '64' }}
            size="sm"
          />
        </Box>
      </Flex>

      {data.feedback.length === 0 ? (
        <EmptyStateCard
          icon={<Icon color="fg.muted" boxSize="10"><Inbox /></Icon>}
          title="No feedback collected"
          description="Responses will appear here once participants submit."
        />
      ) : (
        <>
          {/* Desktop table */}
          <Box display={{ base: 'none', md: 'block' }} borderWidth="1px" borderColor="border.subtle" borderRadius="lg" overflow="hidden" bg="bg.surface">
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  {['Slide', 'Name', 'Email', 'Question', 'Type', 'Response', 'Submitted'].map((h) => (
                    <Table.ColumnHeader key={h}>{h}</Table.ColumnHeader>
                  ))}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {filtered.map((f, i) => (
                  <Table.Row key={i}>
                    <Table.Cell fontFamily="mono">{f.slideNumber}</Table.Cell>
                    <Table.Cell fontWeight="medium">{f.user.name}</Table.Cell>
                    <Table.Cell color="fg.muted">{f.user.email}</Table.Cell>
                    <Table.Cell color="fg.muted">{f.question ?? '—'}</Table.Cell>
                    <Table.Cell>
                      <Tag.Root colorPalette="green" variant="surface" size="sm" textTransform="uppercase" fontSize="xs">
                        {f.feedbackType}
                      </Tag.Root>
                    </Table.Cell>
                    <Table.Cell>{f.response ?? '—'}</Table.Cell>
                    <Table.Cell color="fg.muted" fontFamily="mono" fontSize="xs">
                      {new Date(f.submittedAt).toISOString().slice(0, 19).replace('T', ' ')}Z
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>

          {/* Mobile cards */}
          <VStack display={{ base: 'flex', md: 'none' }} gap="2" align="stretch">
            {filtered.map((f, i) => (
              <Box key={i} borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="4">
                <Flex justify="space-between" align="center" mb="2">
                  <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                    Slide {f.slideNumber}
                  </Text>
                  <Tag.Root colorPalette="green" variant="surface" size="sm" textTransform="uppercase" fontSize="xs">
                    {f.feedbackType}
                  </Tag.Root>
                </Flex>
                <Text fontWeight="medium" mb="1">
                  {f.user.name} · {f.user.email}
                </Text>
                {f.question && (
                  <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="1">
                    {f.question}
                  </Text>
                )}
                <Text>{f.response ?? '—'}</Text>
              </Box>
            ))}
          </VStack>
        </>
      )}

      {/* Default-question responses */}
      {data.defaultQuestions.length > 0 && (
        <Box>
          <HStack gap="2" mb="3">
            <Sparkles size={18} color="var(--chakra-colors-green-solid)" />
            <Text fontWeight="bold" textTransform="uppercase" letterSpacing="wide">
              Default Responses
            </Text>
          </HStack>

          {data.defaultFeedback.length === 0 ? (
            <Text color="fg.muted" fontSize="sm">
              No default-question responses collected.
            </Text>
          ) : (
            <>
              <Box display={{ base: 'none', md: 'block' }} borderWidth="1px" borderColor="border.subtle" borderRadius="lg" overflow="hidden" bg="bg.surface">
                <Table.Root size="sm">
                  <Table.Header>
                    <Table.Row>
                      {['Slide', 'Name', 'Email', 'Question', 'Type', 'Response', 'Submitted'].map((h) => (
                        <Table.ColumnHeader key={h}>{h}</Table.ColumnHeader>
                      ))}
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data.defaultFeedback.map((f, i) => (
                      <Table.Row key={i}>
                        <Table.Cell fontFamily="mono">{f.slideNumber}</Table.Cell>
                        <Table.Cell fontWeight="medium">{f.user.name}</Table.Cell>
                        <Table.Cell color="fg.muted">{f.user.email}</Table.Cell>
                        <Table.Cell color="fg.muted">{f.question}</Table.Cell>
                        <Table.Cell>
                          <Tag.Root colorPalette="green" variant="surface" size="sm" textTransform="uppercase" fontSize="xs">
                            {f.questionType}
                          </Tag.Root>
                        </Table.Cell>
                        <Table.Cell textTransform="capitalize">{f.response ?? '—'}</Table.Cell>
                        <Table.Cell color="fg.muted" fontFamily="mono" fontSize="xs">
                          {new Date(f.submittedAt).toISOString().slice(0, 19).replace('T', ' ')}Z
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Box>

              <VStack display={{ base: 'flex', md: 'none' }} gap="2" align="stretch" mt="3">
                {data.defaultFeedback.map((f, i) => (
                  <Box key={i} borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.surface" p="4">
                    <Flex justify="space-between" align="center" mb="2">
                      <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider">
                        Slide {f.slideNumber}
                      </Text>
                      <Tag.Root colorPalette="green" variant="surface" size="sm" textTransform="uppercase" fontSize="xs">
                        {f.questionType}
                      </Tag.Root>
                    </Flex>
                    <Text fontWeight="medium" mb="1">
                      {f.user.name} · {f.user.email}
                    </Text>
                    <Text color="fg.muted" fontSize="xs" textTransform="uppercase" letterSpacing="wider" mb="1">
                      {f.question}
                    </Text>
                    <Text textTransform="capitalize">{f.response ?? '—'}</Text>
                  </Box>
                ))}
              </VStack>
            </>
          )}
        </Box>
      )}
    </VStack>
  );
}
