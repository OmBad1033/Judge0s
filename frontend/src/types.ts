export type FeedbackType = 'disabled' | 'boolean' | 'multiple_choice' | 'open_text';

export interface Presentation {
  id: string;
  title: string;
  originalFilename: string;
  r2ObjectKey: string | null;
  slideCount: number;
  createdAt: string;
}

export interface SlideFeedbackRule {
  enabled: boolean;
  required: boolean;
  feedbackType: FeedbackType;
  question: string | null;
  options: string[] | null;
  allowResubmission: boolean;
}

export interface Slide {
  id: string;
  presentationId: string;
  slideNumber: number;
  title: string | null;
  summary: string;
  createdAt: string;
  feedbackRule: SlideFeedbackRule | null;
}

export interface SlidesResponse {
  presentation: Presentation;
  slides: Slide[];
}

export type DefaultQuestionType = 'interested' | 'rating';

export interface DefaultQuestionDto {
  id: string;
  questionText: string;
  questionType: DefaultQuestionType;
}

export interface DefaultQuestion extends DefaultQuestionDto {
  presentationId: string;
  targetSlides: number[];
  createdAt: string;
}

export interface SlideEventRule {
  enabled: boolean;
  required: boolean;
  type: FeedbackType;
  question: string | null;
  options: string[] | null;
  allowResubmission: boolean;
}

export interface SlideEvent {
  type: 'SLIDE_CHANGED' | 'SESSION_ENDED' | 'NO_ACTIVE_SLIDE';
  slideNumber?: number;
  slide?: { slideNumber: number; title: string | null; summary: string };
  feedbackRule?: SlideEventRule | null;
  defaultQuestions?: DefaultQuestionDto[];
  status?: string;
}

export interface Session {
  id: string;
  presentationId: string;
  sessionCode: string;
  name: string | null;
  status: 'draft' | 'live' | 'paused' | 'ended';
  currentSlideNumber: number | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  presentationTitle: string;
  slideCount: number;
}

export interface JoinResponse {
  participantId: string;
  sessionCode: string;
  status: string;
  currentSlide: number | null;
}

export interface StoredResponse {
  id: string;
  slideNumber: number;
  feedbackType: string;
  question: string | null;
  responseValue: string | null;
  submittedAt: string;
}

export interface StoredDefaultResponse {
  id: string;
  slideNumber: number;
  defaultQuestionId: string;
  questionType: string;
  questionText: string;
  responseValue: string | null;
  submittedAt: string;
}

export interface ExportFeedbackItem {
  slideNumber: number;
  user: { name: string; email: string };
  question: string | null;
  feedbackType: string;
  response: string | null;
  submittedAt: string;
}

export interface ExportData {
  session: { code: string; presentation: string; status: string };
  feedback: ExportFeedbackItem[];
  defaultQuestions: {
    id: string;
    questionText: string;
    questionType: string;
    targetSlides: number[];
  }[];
  defaultFeedback: {
    slideNumber: number;
    user: { name: string; email: string };
    question: string;
    questionType: string;
    response: string | null;
    submittedAt: string;
  }[];
}

// --- P1/P2 backend consumers (see backend_change_plan.md) ---

export interface PresentationSummary {
  id: string;
  title: string;
  originalFilename: string;
  slideCount: number;
  createdAt: string;
  configuredSlides: number;
  latestSession: {
    sessionCode: string;
    status: 'draft' | 'live' | 'ended';
    currentSlideNumber: number | null;
  } | null;
}

export interface SessionStatsEvent {
  type: 'SESSION_STATS_UPDATED';
  participantCount: number;
  currentSlideResponseCount: number;
}

export interface ParticipantState {
  session: {
    sessionCode: string;
    status: string;
    presentationTitle: string;
    currentSlideNumber: number | null;
  };
  event: SlideEvent;
  existingResponse: StoredResponse | null;
  responses: StoredResponse[];
  defaultResponses: StoredDefaultResponse[];
}

export interface ControlSlideSummary {
  slideNumber: number;
  title: string | null;
  summary: string | null;
  configured: boolean;
  feedbackType: string;
}

export interface ControlState {
  session: Session;
  slides: ControlSlideSummary[];
  participantCount: number;
  responseCount: number;
  currentSlideResponseCount: number;
}

// FR-1 — Deep-link-friendly session lookup.
export interface JoinInfo {
  sessionCode: string;
  status: 'draft' | 'live' | 'ended';
  presentationTitle: string;
  joinable: boolean;
  reason: 'ENDED' | 'NOT_FOUND' | null;
}

// FR-3 — Extended live-stats broadcast (additive on top of SessionStatsEvent).
export interface SessionStatsEventV2 {
  type: 'SESSION_STATS_UPDATED';
  participantCount: number;
  currentSlideResponseCount: number;
  totalResponseCount?: number;
  currentSlide?: {
    slideNumber: number;
    fieldBreakdown: Array<
      | { fieldId: string; feedbackType: 'boolean' | 'multiple_choice' | 'open_text'; counts: Record<string, number> }
      | { fieldId: string; questionType: 'interested' | 'rating'; average: number; count: number }
    >;
  };
}

// FR-5 — Real participant list (replaces the deterministic mock in lib/mockParticipants.ts).
export interface SessionParticipant {
  id: string;
  name: string;
  joinedAt: string;
  lastSeenAt: string | null;
  hasCurrentSlideResponse: boolean;
  totalResponses: number;
}

// FR-2 — Extended participant-state shape (additive — older fields stay).
export interface PreviousSlideMarker {
  slideNumber: number;
  hasResponse: boolean;
}

// Shared connection-state vocabulary used by both the participant and the admin live control room.
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected' | 'ended';

// --- Post-session analytics (SessionAnalytics page) ---

export interface TextInsight {
  themes: { name: string; count: number }[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  sentimentScore: number; // -1..1
  summary: string;
}

export type FieldStats =
  | { kind: 'boolean'; yesCount: number; noCount: number; yesPct: number }
  | { kind: 'single_select'; counts: Record<string, number> }
  | {
      kind: 'multi_select';
      counts: Record<string, number>;
      coOccurrence: Record<string, Record<string, number>>;
    }
  | { kind: 'rating'; distribution: Record<string, number>; average: number }
  | { kind: 'nps'; distribution: Record<string, number>; average: number; nps: number }
  | { kind: 'text'; responses: string[]; insight: TextInsight | null };

export interface FieldAnalytics {
  fieldId: string;
  label: string;
  fieldType: string;
  options: string[] | null;
  responseCount: number;
  participantCount: number;
  stats: FieldStats;
}

export interface SlideAnalytics {
  slideNumber: number;
  title: string | null;
  summary: string;
  fields: FieldAnalytics[];
}

export interface DefaultQuestionAnalytics {
  id: string;
  questionText: string;
  questionType: string;
  targetSlides: number[];
  responseCount: number;
  participantCount: number;
  stats:
    | { kind: 'interested'; interestedCount: number; notInterestedCount: number; interestedPct: number }
    | { kind: 'rating'; distribution: Record<string, number>; average: number };
}

export interface SessionAnalytics {
  session: {
    code: string;
    presentation: string;
    status: string;
    participantCount: number;
    slideCount: number;
    startedAt: string | null;
    endedAt: string | null;
  };
  slides: SlideAnalytics[];
  defaultQuestions: DefaultQuestionAnalytics[];
  hasAi: boolean;
  aiConfigured: boolean;
  aiResults?: { fieldId: string; ok: boolean; error?: string }[];
}
