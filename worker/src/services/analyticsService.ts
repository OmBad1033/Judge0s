import type { Env } from '../env';
import * as sessionService from './sessionService';
import * as slideService from './slideService';
import * as defaultQuestionService from './defaultQuestionService';
import type { TextInsight } from './openRouterService';

// ---------------------------------------------------------------------------
// Response-value encoding
//
// feedback_responses.response_value is a single TEXT column. Phase 3 field
// types are serialized as JSON strings:
//   boolean            -> 'yes' | 'no'
//   single_select      -> chosen option (plain string)
//   multi_select       -> JSON.stringify([...selected options])
//   rating / nps       -> JSON.stringify(number)  e.g. '7'
//   text / textarea    -> raw string
// ---------------------------------------------------------------------------

export interface FieldAnalytics {
  fieldId: string;
  label: string;
  fieldType: string;
  options: string[] | null;
  responseCount: number;
  participantCount: number;
  stats:
    | { kind: 'boolean'; yesCount: number; noCount: number; yesPct: number }
    | { kind: 'single_select'; counts: Record<string, number> }
    | { kind: 'multi_select'; counts: Record<string, number>; coOccurrence: Record<string, Record<string, number>> }
    | { kind: 'rating'; distribution: Record<string, number>; average: number }
    | { kind: 'nps'; distribution: Record<string, number>; average: number; nps: number }
    | { kind: 'text'; responses: string[]; insight: TextInsight | null };
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
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function parseDistribution(values: string[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const raw of values) {
    const n = Number(raw);
    if (Number.isInteger(n) && !Number.isNaN(n)) dist[String(n)] = (dist[String(n)] ?? 0) + 1;
  }
  return dist;
}

function averageOf(values: string[]): number {
  let sum = 0;
  let count = 0;
  for (const raw of values) {
    const n = Number(raw);
    if (!Number.isNaN(n)) {
      sum += n;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

export async function getSessionAnalytics(env: Env, code: string): Promise<SessionAnalytics | null> {
  const session = await sessionService.getSession(env, code);
  if (!session) return null;

  const participantCount = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM participants WHERE session_id = ?',
  )
    .bind(session.id)
    .first<{ c: number }>();

  const slides = await slideService.listSlides(env, session.presentationId);

  // One query for all responses in this session, joined to slides.
  const { results: respRows } = await env.DB.prepare(
    `SELECT s.slide_number AS slide_number, fr.response_value AS response_value
     FROM feedback_responses fr
     JOIN slides s ON s.id = fr.slide_id
     WHERE fr.session_id = ?`,
  )
    .bind(session.id)
    .all<{ slide_number: number; response_value: string | null }>();

  const bySlide = new Map<number, string[]>();
  for (const r of respRows) {
    const arr = bySlide.get(r.slide_number) ?? [];
    if (r.response_value) arr.push(r.response_value);
    bySlide.set(r.slide_number, arr);
  }

  // Gather all text responses per field for the AI panel (empty-field responses
  // are counted in responseCount but not sent to the LLM).
  const textByField = new Map<string, string[]>();
  const slideAnalytics: SlideAnalytics[] = [];
  const allFields: { fieldId: string; responses: string[] }[] = [];

  for (const slide of slides) {
    const fields = await slideService.getSlideFields(env, slide.id);
    const fieldAnalytics: FieldAnalytics[] = [];

    for (const f of fields) {
      const rawResponses = bySlide.get(slide.slideNumber) ?? [];
      const opts = f.options ?? [];
      const base = {
        fieldId: f.id,
        label: f.label,
        fieldType: f.fieldType,
        options: f.options,
        responseCount: rawResponses.length,
        participantCount: participantCount?.c ?? 0,
      };

      switch (f.fieldType) {
        case 'boolean': {
          const counts = countBy(rawResponses);
          const yesCount = counts['yes'] ?? 0;
          const noCount = counts['no'] ?? 0;
          const total = yesCount + noCount;
          fieldAnalytics.push({
            ...base,
            stats: {
              kind: 'boolean',
              yesCount,
              noCount,
              yesPct: total > 0 ? (yesCount / total) * 100 : 0,
            },
          });
          break;
        }
        case 'single_select': {
          const counts: Record<string, number> = {};
          for (const opt of opts) counts[opt] = 0;
          for (const r of rawResponses) if (r in counts) counts[r] = (counts[r] ?? 0) + 1;
          fieldAnalytics.push({ ...base, stats: { kind: 'single_select', counts } });
          break;
        }
        case 'multi_select': {
          const counts: Record<string, number> = {};
          for (const opt of opts) counts[opt] = 0;
          const pickedByOption = new Map<string, number>();
          for (const r of rawResponses) {
            let selected: string[] = [];
            try {
              const parsed = JSON.parse(r);
              selected = Array.isArray(parsed) ? parsed.map(String) : [];
            } catch {
              selected = r.split(',').map((s) => s.trim());
            }
            for (const opt of selected) {
              if (opt in counts) counts[opt] = (counts[opt] ?? 0) + 1;
              pickedByOption.set(opt, (pickedByOption.get(opt) ?? 0) + 1);
            }
          }
          // Co-occurrence: for each option, how often each other option was
          // picked in the same response set.
          const coOccurrence: Record<string, Record<string, number>> = {};
          for (const r of rawResponses) {
            let selected: string[] = [];
            try {
              const parsed = JSON.parse(r);
              selected = Array.isArray(parsed) ? parsed.map(String) : [];
            } catch {
              selected = r.split(',').map((s) => s.trim());
            }
            const unique = [...new Set(selected)];
            for (const a of unique) {
              if (!(a in opts)) continue;
              coOccurrence[a] ??= {};
              for (const b of unique) {
                if (a === b) continue;
                coOccurrence[a][b] = (coOccurrence[a][b] ?? 0) + 1;
              }
            }
          }
          fieldAnalytics.push({ ...base, stats: { kind: 'multi_select', counts, coOccurrence } });
          break;
        }
        case 'rating': {
          const dist = parseDistribution(rawResponses);
          fieldAnalytics.push({
            ...base,
            stats: { kind: 'rating', distribution: dist, average: averageOf(rawResponses) },
          });
          break;
        }
        case 'nps': {
          const dist = parseDistribution(rawResponses);
          const promoters = Object.entries(dist).reduce((a, [k, v]) => a + (Number(k) >= 9 ? v : 0), 0);
          const detractors = Object.entries(dist).reduce((a, [k, v]) => a + (Number(k) <= 6 ? v : 0), 0);
          const total = Object.values(dist).reduce((a, b) => a + b, 0);
          const nps = total > 0 ? ((promoters - detractors) / total) * 100 : 0;
          fieldAnalytics.push({
            ...base,
            stats: { kind: 'nps', distribution: dist, average: averageOf(rawResponses), nps },
          });
          break;
        }
        case 'text':
        case 'textarea': {
          const texts = rawResponses.filter((t) => t.trim().length > 0);
          textByField.set(f.id, texts);
          allFields.push({ fieldId: f.id, responses: texts });
          const insight = await getCachedInsight(env, f.id);
          fieldAnalytics.push({
            ...base,
            stats: { kind: 'text', responses: texts, insight },
          });
          break;
        }
      }
    }

    slideAnalytics.push({
      slideNumber: slide.slideNumber,
      title: slide.title,
      summary: slide.summary,
      fields: fieldAnalytics,
    });
  }

  // Default questions (interested / rating) — aggregated across all slides.
  const defaultQuestions = await defaultQuestionService.listDefaultQuestions(env, session.presentationId);
  const { results: drRows } = await env.DB.prepare(
    `SELECT dq.id AS dq_id, dq.question_type AS question_type, dr.response_value AS response_value
     FROM default_responses dr
     JOIN default_questions dq ON dq.id = dr.default_question_id
     WHERE dr.session_id = ?`,
  )
    .bind(session.id)
    .all<{ dq_id: string; question_type: string; response_value: string | null }>();

  const byQuestion = new Map<string, string[]>();
  for (const r of drRows) {
    const arr = byQuestion.get(r.dq_id) ?? [];
    if (r.response_value) arr.push(r.response_value);
    byQuestion.set(r.dq_id, arr);
  }

  const defaultAnalytics: DefaultQuestionAnalytics[] = [];
  for (const q of defaultQuestions) {
    const values = byQuestion.get(q.id) ?? [];
    if (q.questionType === 'rating') {
      defaultAnalytics.push({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        targetSlides: q.targetSlides,
        responseCount: values.length,
        participantCount: participantCount?.c ?? 0,
        stats: {
          kind: 'rating',
          distribution: parseDistribution(values),
          average: averageOf(values),
        },
      });
    } else {
      const counts = countBy(values.map((v) => v.toLowerCase()));
      const interested = counts['interested'] ?? 0;
      const notInterested = counts['not_interested'] ?? 0;
      const total = interested + notInterested;
      defaultAnalytics.push({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        targetSlides: q.targetSlides,
        responseCount: values.length,
        participantCount: participantCount?.c ?? 0,
        stats: {
          kind: 'interested',
          interestedCount: interested,
          notInterestedCount: notInterested,
          interestedPct: total > 0 ? (interested / total) * 100 : 0,
        },
      });
    }
  }

  const hasAi = allFields.some((f) => f.responses.length > 0);

  return {
    session: {
      code: session.sessionCode,
      presentation: session.presentationTitle,
      status: session.status,
      participantCount: participantCount?.c ?? 0,
      slideCount: session.slideCount,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    },
    slides: slideAnalytics,
    defaultQuestions: defaultAnalytics,
    hasAi,
    aiConfigured: !!env.OPENROUTER_API_KEY,
  };
}

export async function getCachedInsight(env: Env, fieldId: string): Promise<TextInsight | null> {
  const row = await env.DB.prepare(
    'SELECT insight_json FROM text_analysis_cache WHERE field_id = ?',
  )
    .bind(fieldId)
    .first<{ insight_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.insight_json) as TextInsight;
  } catch {
    return null;
  }
}
