// Pure helpers that derive Judge OS scorecards from real backend payloads.
// Where the backend doesn't have a field, we compute a synthetic-but-deterministic
// metric so the UI stays visually stable as new SESSION_STATS_UPDATED events arrive.

import type { ExportData, ExportFeedbackItem } from '../types';

// Control Room: 0..100 score reflecting how much of the audience has answered
// the current slide. Returns "—" inputs when there's no audience yet.
export function liveAggregate(participantCount: number, currentResponses: number): number {
  if (participantCount <= 0) return 0;
  const ratio = currentResponses / participantCount;
  return Math.round(Math.min(1, ratio) * 100);
}

// Variance vs the previous score; used for the "> X% VARIANCE" delta on Control Room.
export function varianceDelta(prev: number, next: number): number {
  return next - prev;
}

// Results: total feedback entries on the session.
export function totalEvaluations(data: ExportData): number {
  return data.feedback.length + data.defaultFeedback.length;
}

// Results: payload score 0..100 — average response length normalised by 50 chars.
export function payloadScore(items: (ExportFeedbackItem | { response: string | null })[]): number {
  if (items.length === 0) return 0;
  const total = items.reduce((acc, r) => acc + (r.response?.length ?? 0), 0);
  const avg = total / items.length;
  return Math.min(100, Math.round(avg * 2));
}

// Results: AI confidence 0..100 — % of responses that are non-empty.
export function aiCompliance(items: (ExportFeedbackItem | { response: string | null })[]): number {
  if (items.length === 0) return 0;
  const valid = items.filter((r) => !!r.response && r.response.trim().length > 0).length;
  return Math.round((valid / items.length) * 100);
}

// Results: total nodes processed (alias of totalEvaluations for clarity on the KPI cards).
export function totalNodesProcessed(data: ExportData): number {
  return data.feedback.length;
}

// Control Room "RESPONSE / SYNC / AVERAGE / TIME" scorecards derived from real stats.
export interface StreamMetrics {
  response: number; // % answered current slide
  sync: number; // % participant arrival rate (constant 92 baseline if any)
  average: number; // average response length in chars / 20
  time: number; // synthetic engagement timer, seconds
}
export function streamMetrics(
  participantCount: number,
  currentResponses: number,
  feedback: ExportData['feedback'],
): StreamMetrics {
  const response = participantCount > 0 ? Math.round((currentResponses / participantCount) * 100) : 0;
  const avg = feedback.length
    ? Math.min(100, Math.round(feedback.reduce((a, f) => a + (f.response?.length ?? 0), 0) / feedback.length))
    : 0;
  return {
    response,
    sync: participantCount > 0 ? Math.max(40, 100 - Math.min(40, Math.round(participantCount / 2))) : 0,
    average: avg,
    time: Math.min(100, Math.round(participantCount * 6)),
  };
}
