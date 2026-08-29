// Deterministic fake roster derived from a real participantCount.
// Pure function: same inputs always yield the same rows, so re-renders
// driven by SESSION_STATS_UPDATED won't shuffle the table.

const ROLES = [
  'Market Analyst',
  'Risk Assessor',
  'Product Lead',
  'Financial Controller',
  'Quant Strategist',
  'Ops Lead',
  'Compliance Reviewer',
  'Investment Associate',
];

// Tiny deterministic hash so each (count, code, index) gives a stable number.
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface MockParticipant {
  id: string;
  role: string;
  score: number;
  status: 'COMPLETE' | 'PENDING' | 'INCOMPLETE';
  joinedAt: string;
}

export function mockParticipants(count: number, sessionCode: string): MockParticipant[] {
  const clamped = Math.max(0, Math.min(count, 50));
  const rows: MockParticipant[] = [];
  for (let i = 0; i < clamped; i++) {
    const h = hash(`${sessionCode}:${i}`);
    const role = ROLES[h % ROLES.length];
    const score = 60 + (h % 39); // 60..98
    const status: MockParticipant['status'] =
      i < clamped - 1 ? 'COMPLETE' : clamped > 0 && i === clamped - 1 ? 'INCOMPLETE' : 'PENDING';
    rows.push({
      id: `USR-${String(i + 1).padStart(4, '0')}`,
      role,
      score,
      status,
      joinedAt: new Date(Date.now() - (clamped - i) * 60_000).toISOString(),
    });
  }
  return rows;
}
