import type {
  Presentation,
  SlidesResponse,
  Session,
  JoinResponse,
  StoredResponse,
  StoredDefaultResponse,
  SlideEvent,
  ExportData,
  FeedbackType,
  PresentationSummary,
  ParticipantState,
  ControlState,
  DefaultQuestion,
  DefaultQuestionType,
  JoinInfo,
  SessionStatsEventV2,
  SessionParticipant,
  SessionAnalytics,
  AiGenerateResult,
  AiSlideGenerateResult,
  AiSuggestionList,
} from './types';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function json<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = res.statusText;
    }
    const msg =
      typeof parsed === 'object' && parsed && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : res.statusText;
    throw new ApiError(msg, res.status, parsed);
  }
  return res.json() as Promise<T>;
}

export interface PutSlideBody {
  title?: string;
  summary: string;
  feedbackRule: {
    enabled: boolean;
    required: boolean;
    feedbackType: FeedbackType;
    question?: string;
    options?: string[];
    allowResubmission: boolean;
  };
}

export const api = {
  adminLogin: (password: string) => json<{ ok: boolean }>('/api/admin/login', 'POST', { password }),
  adminMe: () =>
    json<{
      ok: boolean;
      role?: 'admin' | 'user';
      user?: { id: string; email: string; name: string | null; avatarUrl: string | null; isSuperAdmin: boolean };
    }>('/api/auth/me', 'GET'),
  adminLogout: async () => {
    await Promise.allSettled([
      fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }),
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }),
    ]);
    return { ok: true };
  },

  createPresentation: (data: { title: string; file: File }) => {
    const form = new FormData();
    form.append('title', data.title);
    form.append('file', data.file);
    return fetch('/api/presentations', { method: 'POST', credentials: 'include', body: form }).then(
      async (r) => {
        if (!r.ok) throw new ApiError((await r.json().catch(() => ({}))).error ?? 'upload failed', r.status, null);
        return r.json() as Promise<Presentation>;
      },
    );
  },
  getPresentation: (id: string) => json<Presentation>(`/api/presentations/${id}`, 'GET'),
  deletePresentation: (id: string) => json<{ ok: boolean }>(`/api/presentations/${id}`, 'DELETE'),
  listPresentations: () => json<{ presentations: PresentationSummary[] }>(`/api/presentations`, 'GET'),
  listSlides: (id: string) => json<SlidesResponse>(`/api/presentations/${id}/slides`, 'GET'),
  putSlide: (id: string, slideNumber: number, body: PutSlideBody) =>
    json(`/api/presentations/${id}/slides/${slideNumber}`, 'PUT', body),
  listDefaultQuestions: (id: string) =>
    json<{ defaultQuestions: DefaultQuestion[] }>(`/api/presentations/${id}/default-questions`, 'GET'),
  createDefaultQuestion: (
    id: string,
    data: { questionText: string; questionType: DefaultQuestionType; targetSlides: number[] },
  ) => json<DefaultQuestion>(`/api/presentations/${id}/default-questions`, 'POST', data),
  deleteDefaultQuestion: (id: string, questionId: string) =>
    json<{ ok: boolean }>(`/api/presentations/${id}/default-questions/${questionId}`, 'DELETE'),

  createSession: (presentationId: string, name?: string) =>
    json<Session>('/api/sessions', 'POST', { presentationId, name }),
  listSessions: (presentationId: string) =>
    json<{ sessions: Session[] }>(`/api/sessions?presentationId=${encodeURIComponent(presentationId)}`, 'GET'),
  getSession: (code: string) => json<Session>(`/api/sessions/${code}`, 'GET'),
  startSession: (code: string) => json<Session>(`/api/sessions/${code}/start`, 'POST'),
  changeSlide: (code: string, slideNumber: number) =>
    json<Session>(`/api/sessions/${code}/slide`, 'PATCH', { slideNumber }),
  endSession: (code: string) => json<Session>(`/api/sessions/${code}/end`, 'POST'),
  currentSlide: (code: string) => json<SlideEvent>(`/api/sessions/${code}/current-slide`, 'GET'),
  controlState: (code: string) => json<ControlState>(`/api/sessions/${code}/control-state`, 'GET'),
  exportSession: (code: string) => json<ExportData>(`/api/sessions/${code}/export`, 'GET'),

  // FR-1 — Deep-link-friendly session lookup. Returns 404 if session does not exist.
  getJoinInfo: (code: string) => json<JoinInfo>(`/api/sessions/${code}/join-info`, 'GET'),

  // FR-2 — Extended participant-state (additive; older fields stay).
  participantState: (code: string, participantId: string) =>
    json<ParticipantState>(`/api/sessions/${code}/participant-state?participantId=${encodeURIComponent(participantId)}`, 'GET'),

  joinSession: (code: string, name: string, email: string) =>
    json<JoinResponse>(`/api/sessions/${code}/join`, 'POST', { name, email }),

  submitFeedback: (code: string, participantId: string, slideNumber: number, response: string) =>
    json<StoredResponse>(`/api/sessions/${code}/feedback`, 'POST', { participantId, slideNumber, response }),
  getMyFeedback: (code: string, participantId: string) =>
    json<{ responses: StoredResponse[] }>(`/api/sessions/${code}/feedback/me?participantId=${encodeURIComponent(participantId)}`, 'GET'),
  submitDefaultFeedback: (code: string, participantId: string, defaultQuestionId: string, slideNumber: number, response: string) =>
    json<StoredDefaultResponse>(`/api/sessions/${code}/feedback/default`, 'POST', { participantId, defaultQuestionId, slideNumber, response }),
  getMyDefaultFeedback: (code: string, participantId: string) =>
    json<{ responses: StoredDefaultResponse[] }>(`/api/sessions/${code}/default-feedback/me?participantId=${encodeURIComponent(participantId)}`, 'GET'),

  // FR-4 — Pause / resume the live session (admin).
  pauseSession: (code: string) => json<Session>(`/api/sessions/${code}/pause`, 'POST'),
  resumeSession: (code: string) => json<Session>(`/api/sessions/${code}/resume`, 'POST'),

  // FR-5 — Real participant list (replaces the deterministic mock).
  listSessionParticipants: (code: string) =>
    json<{ participants: SessionParticipant[] }>(`/api/sessions/${code}/participants`, 'GET'),

  // FR-6 — Direct CSV download URL (lets the browser handle the download).
  exportSessionCsvUrl: (code: string) => `/api/sessions/${code}/export?format=csv`,

  // Post-session analytics dashboard.
  sessionAnalytics: (code: string) => json<SessionAnalytics>(`/api/sessions/${code}/analytics`, 'GET'),
  runSessionAi: (code: string) => json<SessionAnalytics>(`/api/sessions/${code}/analytics/ai`, 'POST'),

  // AI slide suggestions (configure page) — mounted at /api/events/:id/ai on
  // the worker; the legacy presentation id === the event id.
  aiGenerate: (presentationId: string) =>
    json<AiGenerateResult>(`/api/events/${presentationId}/ai/generate`, 'POST'),
  aiGenerateSlide: (presentationId: string, slideNumber: number) =>
    json<AiSlideGenerateResult>(`/api/events/${presentationId}/ai/slides/${slideNumber}/generate`, 'POST'),
  aiContext: (presentationId: string) =>
    json<{ context: string | null }>(`/api/events/${presentationId}/ai/context`, 'GET'),
  aiSetContext: (presentationId: string, context: string) =>
    json<{ ok: boolean; context: string | null }>(`/api/events/${presentationId}/ai/context`, 'PUT', { context }),
  aiSuggestions: (presentationId: string) =>
    json<AiSuggestionList>(`/api/events/${presentationId}/ai/suggestions`, 'GET'),
  aiApprove: (
    presentationId: string,
    slideId: string,
    body: { title?: string; summary?: string; comment?: string },
  ) => json<{ ok: boolean }>(`/api/events/${presentationId}/ai/suggestions/${slideId}/approve`, 'POST', body),
  aiReject: (presentationId: string, slideId: string, body: { comment?: string }) =>
    json<{ ok: boolean }>(`/api/events/${presentationId}/ai/suggestions/${slideId}/reject`, 'POST', body),
  aiRevise: (presentationId: string, slideId: string, comments: string) =>
    json<{ ok: boolean; suggestion?: unknown }>(
      `/api/events/${presentationId}/ai/suggestions/${slideId}/revise`,
      'POST',
      { comments },
    ),

  // Acknowledgement of the latest live-stats broadcast shape.
  acknowledgeStats: (stats: SessionStatsEventV2) => stats,
};
