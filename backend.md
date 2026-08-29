# Backend Documentation

Live Presentation Feedback System — Cloudflare Worker backend.

The backend is a single **Cloudflare Worker** written in TypeScript, built on
**Hono** (router) + **Zod** (validation). It is a monorepo package
(`worker/`) managed with pnpm workspaces. It coordinates three Cloudflare
storage/compute primitives:

- **D1** — SQLite database: stores all persisted entities (presentations,
  slides, feedback rules, sessions, participants, responses, default
  questions/responses).
- **R2** — object storage: stores the uploaded `.pptx` artifact per
  presentation.
- **Durable Object** (`PresentationSession`) — coordinates real-time state:
  WebSocket fan-out of slide changes, session end, and live stats.

The Worker also serves the built React frontend as **Static Assets** (single
deploy unit).

---

## Table of contents

1. [Project structure](#project-structure)
2. [Environment bindings](#environment-bindings)
3. [Configuration (wrangler.jsonc)](#configuration-wranglerjsonc)
4. [Database (D1)](#database-d1)
   - [Schema](#schema)
   - [Entities](#entities)
5. [Authentication](#authentication)
6. [API routes](#api-routes)
   - [Health](#health)
   - [Admin auth](#admin-auth)
   - [Presentations](#presentations)
   - [Slides](#slides)
   - [Sessions](#sessions)
   - [Participant flow](#participant-flow)
   - [Feedback](#feedback)
   - [Default questions & responses](#default-questions--responses)
   - [Export](#export)
   - [WebSocket](#websocket)
7. [Real-time protocol](#real-time-protocol)
8. [Validation rules](#validation-rules)
9. [Error codes](#error-codes)
10. [Services layer](#services-layer)
11. [Utilities](#utilities)
12. [Scripts](#scripts)

---

## Project structure

```
worker/
├── migrations/
│   ├── 0001_init.sql                  # core schema (v1)
│   └── 0002_default_questions.sql    # default questions + responses (v2)
├── src/
│   ├── index.ts                      # Hono app entry, route mounting, WS upgrade
│   ├── env.ts                        # Worker bindings + secrets interface
│   ├── durable-objects/
│   │   └── PresentationSession.ts    # WebSocket fan-out DO
│   ├── routes/
│   │   ├── auth.ts                   # /api/admin/*
│   │   ├── presentations.ts          # /api/presentations/*
│   │   ├── slides.ts                 # /api/presentations/:id/slides/*
│   │   └── sessions.ts               # /api/sessions/* (largest surface)
│   ├── services/
│   │   ├── presentationService.ts
│   │   ├── slideService.ts
│   │   ├── sessionService.ts
│   │   ├── participantService.ts
│   │   ├── feedbackService.ts
│   │   ├── defaultQuestionService.ts
│   │   ├── defaultResponseService.ts
│   │   └── exportService.ts
│   ├── utils/
│   │   ├── auth.ts                   # token sign/verify + admin guard
│   │   ├── common.ts                 # ids, timestamps, HMAC, base64url
│   │   └── sessionCode.ts            # human-friendly session code generator
│   └── validation/
│       └── feedback.ts               # Zod schemas + response validators
├── .dev.vars.example                 # local dev secrets template
├── package.json
├── tsconfig.json
└── wrangler.jsonc
```

---

## Environment bindings

Defined in `src/env.ts` as the `Env` interface. Accessed on the Hono context
as `c.env`.

| Binding | Type | Purpose |
|---|---|---|
| `DB` | `D1Database` | SQLite database (all persisted data) |
| `PRESENTATION_BUCKET` | `R2Bucket` | `.pptx` file storage |
| `PRESENTATION_SESSION` | `DurableObjectNamespace` | Per-session real-time coordinator |
| `ASSETS` | `Fetcher` | Built frontend static assets |
| `ADMIN_PASSWORD` | `string` | Admin login password (local dev fallback) |
| `SESSION_SECRET` | `string` | HMAC key for signed admin session cookie |
| `CF_ACCESS_TEAM_DOMAIN` | `string?` | Cloudflare Access team domain (unused TODO) |
| `ENVIRONMENT` | `string` | `local` or `production`; controls cookie `secure` flag |

Secrets for local dev live in `worker/.dev.vars` (gitignored; copy from
`.dev.vars.example`).

---

## Configuration (wrangler.jsonc)

| Key | Value |
|---|---|
| `name` | `live-feedback-worker` |
| `main` | `src/index.ts` |
| `compatibility_date` | `2025-04-01` |
| `assets` | directory `../frontend/dist`, binding `ASSETS`, SPA not-found handling, `run_worker_first: true` (Worker routes win over assets) |
| D1 database | binding `DB`, database `live-feedback-db`, migrations dir `migrations` |
| R2 bucket | binding `PRESENTATION_BUCKET`, bucket `live-feedback-presentations` |
| Durable Object | binding `PRESENTATION_SESSION` → class `PresentationSession` (migration tag `v1`) |

`run_worker_first: true` means the Worker's routes (e.g. `/api/*`, `/ws/*`)
are evaluated before the static asset handler; everything else falls through to
the SPA.

---

## Database (D1)

SQLite via Cloudflare D1. Two migration files define the schema. All IDs are
`crypto.randomUUID()` strings; all timestamps are ISO-8601 strings.

### Schema

**`0001_init.sql`** — core entities:

```sql
presentations          -- uploaded deck metadata
slides                 -- per-slide admin configuration
feedback_rules         -- 1:1 feedback rule per slide
presentation_sessions  -- live session instances
participants           -- joiners per session
feedback_responses     -- slide-rule feedback per participant
```

**`0002_default_questions.sql`** — generic questions applied across slides:

```sql
default_questions      -- 'interested' | 'rating' questions targeting slides
default_responses      -- participant answers to default questions
```

### Entities

#### `presentations`

A single uploaded presentation deck. The actual `.pptx` lives in R2; the row
only holds metadata.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `title` | TEXT NOT NULL | Display title |
| `original_filename` | TEXT NOT NULL | Uploaded file name |
| `r2_object_key` | TEXT | Key in the R2 bucket (nullable) |
| `slide_count` | INTEGER NOT NULL | Manually entered at upload |
| `created_at` | TEXT NOT NULL | ISO timestamp |

Related rows: many `slides`, many `presentation_sessions`, many
`default_questions`.

#### `slides`

Admin-configured metadata for one slide number of a presentation. Slides are
created lazily via upsert — only slides the admin configures exist as rows.
The count itself comes from `presentations.slide_count`.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `presentation_id` | TEXT NOT NULL FK → presentations |
| `slide_number` | INTEGER NOT NULL | 1-based, unique per presentation |
| `title` | TEXT | Nullable (blank slides) |
| `summary` | TEXT NOT NULL | Rendered on the participant screen |
| `created_at` | TEXT NOT NULL | |

Unique: `(presentation_id, slide_number)`. Index: `idx_slides_presentation`.

#### `feedback_rules`

1:1 with a slide (one `slide_id`, unique). Stores the question form shown to
participants on that slide.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `slide_id` | TEXT NOT NULL UNIQUE FK → slides |
| `enabled` | INTEGER (0/1) | Default 0 |
| `required` | INTEGER (0/1) | Default 0 |
| `feedback_type` | TEXT NOT NULL | `disabled` \| `boolean` \| `multiple_choice` \| `open_text` |
| `question` | TEXT | Prompt text (nullable) |
| `options_json` | TEXT | JSON array of options for `multiple_choice` |
| `allow_resubmission` | INTEGER (0/1) | Default 0 |

#### `presentation_sessions`

One "run" of a presentation that participants can join.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `presentation_id` | TEXT NOT NULL FK → presentations |
| `session_code` | TEXT NOT NULL UNIQUE | 6-char code, e.g. `K7M2P9` |
| `status` | TEXT NOT NULL | `draft` → `live` → `ended` |
| `current_slide_number` | INTEGER | Nullable; null until started |
| `created_at` | TEXT NOT NULL | |
| `started_at` | TEXT | Nullable |
| `ended_at` | TEXT | Nullable |

Index: `idx_sessions_presentation`. The Durable Object name is derived from
`session_code`, so each session gets its own WebSocket fan-out instance.

#### `participants`

A person who joined a session (by name + email). Re-joining with the same
email upserts the name and returns the same participant ID.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT NOT NULL FK → presentation_sessions |
| `name` | TEXT NOT NULL | |
| `email` | TEXT NOT NULL | |
| `joined_at` | TEXT NOT NULL | |

Unique: `(session_id, email)`. Index: `idx_participants_session`.

#### `feedback_responses`

Answers to a slide's own feedback rule.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT NOT NULL FK → presentation_sessions |
| `participant_id` | TEXT NOT NULL FK → participants |
| `slide_id` | TEXT NOT NULL FK → slides |
| `feedback_type` | TEXT NOT NULL | Snapshot of the rule type at submit time |
| `question` | TEXT | Snapshot of the question at submit time |
| `response_value` | TEXT | The answer (`yes`/`no`, chosen option, or text) |
| `submitted_at` | TEXT NOT NULL | |

Unique: `(participant_id, slide_id)` — one response per participant per slide.
Indexes: `idx_responses_session`, `idx_responses_slide`.

Resubmission is enforced here: if a row already exists and
`allow_resubmission` is false, the submit is rejected with `409`.

#### `default_questions`

Generic questions an admin creates once and targets at specific slide numbers
(e.g. "Interested / Not interested", "Rate 0–10"). Shown to participants on
each targeted slide alongside the slide's own rule.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `presentation_id` | TEXT NOT NULL FK → presentations |
| `question_text` | TEXT NOT NULL | |
| `question_type` | TEXT NOT NULL | `interested` \| `rating` |
| `target_slides` | TEXT NOT NULL | JSON array of slide numbers, default `'[]'` |
| `created_at` | TEXT NOT NULL | |

Index: `idx_default_questions_presentation`.

#### `default_responses`

Answers to default questions, keyed per question + slide.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT NOT NULL FK → presentation_sessions |
| `participant_id` | TEXT NOT NULL FK → participants |
| `default_question_id` | TEXT NOT NULL FK → default_questions |
| `slide_number` | INTEGER NOT NULL | Which slide this answer targets |
| `response_value` | TEXT NOT NULL | `interested`/`not_interested` or `0`–`10` |
| `submitted_at` | TEXT NOT NULL | |

Unique: `(participant_id, default_question_id, slide_number)` — upsert on
resubmit (always allowed). Index: `idx_default_responses_session`.

---

## Authentication

Two paths, switched by `adminGuard` (`src/utils/auth.ts`):

1. **Production (Cloudflare Access):** the edge proxy injects a
   `Cf-Access-Jwt-Assertion` header. If present, the guard trusts it and lets
   the request through. *(TODO: verify the JWT signature via Access JWKS once
   `CF_ACCESS_TEAM_DOMAIN` is configured.)*
2. **Local dev (password login):** `POST /api/admin/login` compares the body
   `password` against `ADMIN_PASSWORD`. On success it issues a signed token —
   `base64url(JSON payload).HMAC-SHA256(payload, SESSION_SECRET)` — and sets it
   as an `httpOnly`, `SameSite=Lax` cookie named `admin_token` (maxAge 24h;
   `secure` only when `ENVIRONMENT === 'production'`). The guard verifies the
   cookie's signature and expiry on every protected request.

Token payload: `{ role: 'admin', exp: <epoch ms> }`.

Protected routes (all under `/api/presentations`, `/api/presentations/:id/slides`,
plus session *control* endpoints) return `401 { error: 'UNAUTHORIZED' }` when
unauthenticated. Participant-facing routes (`join`, `feedback`, `current-slide`,
etc.) are intentionally public — the participant ID is the only handle.

---

## API routes

Mounted in `src/index.ts`:

```
GET    /api/health
/api/admin/*                                  → routes/auth.ts
/api/presentations/*                          → routes/presentations.ts
/api/presentations/:id/slides/*               → routes/slides.ts
/api/sessions/*                               → routes/sessions.ts
GET    /ws/session/:code                      → Durable Object upgrade
*      (fallthrough)                          → static assets (SPA)
```

### Health

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/health` | none | – | `{ status: 'ok', db: true }` | 500 if DB unreachable |

Runs `SELECT 1` against D1 and reports `db: false` if it fails.

### Admin auth (`/api/admin`)

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/admin/login` | none | `{ password }` | `{ ok: true }` + sets `admin_token` cookie | 401 `INVALID_CREDENTIALS` |
| POST | `/api/admin/logout` | none | – | `{ ok: true }` + clears cookie | – |
| GET | `/api/admin/me` | admin | – | `{ ok: true, role: 'admin' }` | 401 `UNAUTHORIZED` |

### Presentations (`/api/presentations`)

All routes require admin auth.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/presentations` | – | `{ presentations: PresentationSummary[] }` (newest first, max 100) | – |
| POST | `/api/presentations` | multipart: `title`, `slideCount`, `file` (.pptx) | `Presentation` (201) | 400 `TITLE_REQUIRED` / `INVALID_SLIDE_COUNT` / `FILE_REQUIRED` / `INVALID_FILE_TYPE` / `FILE_TOO_LARGE` |
| GET | `/api/presentations/:id` | – | `Presentation` | 404 `NOT_FOUND` |
| GET | `/api/presentations/:id/default-questions` | – | `{ defaultQuestions: DefaultQuestion[] }` | – |
| POST | `/api/presentations/:id/default-questions` | `{ questionText, questionType, targetSlides }` | `DefaultQuestion` (201) | 400 `VALIDATION_ERROR` |
| DELETE | `/api/presentations/:id/default-questions/:qid` | – | `{ ok: true }` | 404 `NOT_FOUND` |

**Upload constraints** (`POST /api/presentations`):
- `title` must be a non-empty string.
- `slideCount` must be a positive integer.
- `file` must be present, named `*.pptx`, and ≤ 50 MB (`MAX_FILE_BYTES`).
- The file is written to R2 at `presentations/<uuid>/<original-name>`, then the
  row is inserted.

**`PresentationSummary`** (list response) adds:
- `configuredSlides` — count of slides rows.
- `latestSession` — `{ sessionCode, status, currentSlideNumber }` of the most
  recent session, or `null`.

### Slides (`/api/presentations/:id/slides`)

All routes require admin auth.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/presentations/:id/slides` | – | `{ presentation, slides: Slide[] }` | 404 `NOT_FOUND` (unknown presentation) |
| PUT | `/api/presentations/:id/slides/:slideNumber` | `{ title?, summary, feedbackRule }` | `Slide` (with `feedbackRule`) | 400 `INVALID_SLIDE_NUMBER` / `SLIDE_OUT_OF_RANGE` / `VALIDATION_ERROR`; 404 `NOT_FOUND` |

`PUT` upserts both the slide row and its `feedback_rules` row (1:1).
`feedbackRule` shape is validated by Zod — see
[Validation rules](#validation-rules). A slide that has never been configured
has no row and no rule; participants see it as a blank slide with feedback
disabled.

### Sessions (`/api/sessions`)

Admin control endpoints require auth; participant endpoints are public.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/sessions` | admin | query `presentationId` (required) | `{ sessions }` (newest first) | 400 `VALIDATION_ERROR` |
| POST | `/api/sessions` | admin | `{ presentationId }` | `Session` (201) | 404 `PRESENTATION_NOT_FOUND` |
| GET | `/api/sessions/:code` | none | – | `Session` (with `presentationTitle`, `slideCount`) | 404 `NOT_FOUND` |
| POST | `/api/sessions/:code/start` | admin | – | `Session` (status `live`, slide 1) | 404 `NOT_FOUND`; 409 `SESSION_ENDED` |
| PATCH | `/api/sessions/:code/slide` | admin | `{ slideNumber }` | `Session` | 400 `SLIDE_OUT_OF_RANGE`; 404 `NOT_FOUND`; 409 `SESSION_NOT_LIVE` |
| POST | `/api/sessions/:code/end` | admin | – | `Session` (status `ended`) | 404 `NOT_FOUND`; 409 `SESSION_NOT_LIVE` |
| GET | `/api/sessions/:code/current-slide` | none | – | `SLIDE_CHANGED`-shaped event or `{ type: 'NO_ACTIVE_SLIDE', status }` | 404 `NOT_FOUND` |
| GET | `/api/sessions/:code/participant-state` | none | query `participantId` | Atomic bootstrap: session summary + current event + existing responses + default responses | 404 `NOT_FOUND` |
| GET | `/api/sessions/:code/control-state` | admin | – | Control room data (session, all slide summaries, counts) | 404 `NOT_FOUND` |
| GET | `/api/sessions/:code/export` | admin | – | Full export JSON | 404 `NOT_FOUND` |

**Session lifecycle:** created as `draft` with no current slide →
`start` sets `live`, `current_slide_number = 1`, broadcasts the slide event →
`PATCH slide` moves the current slide and broadcasts → `end` sets `ended`,
`ended_at`, broadcasts `SESSION_ENDED`. Only `live` sessions accept slide
changes, feedback, and default feedback. `start` is idempotent-ish for the
started_at timestamp (`COALESCE`), and re-starting a live session just
re-broadcasts slide 1.

**Session codes:** 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
(no `0/O/1/I`). Generation retries up to 5 times on UNIQUE collisions.

**`participant-state`** (public, used to bootstrap the participant UI)
returns:

```json
{
  "session": { "sessionCode", "status", "presentationTitle", "currentSlideNumber" },
  "event": { "type": "SLIDE_CHANGED", ... } | { "type": "NO_ACTIVE_SLIDE", "status" },
  "existingResponse": { ... } | null,
  "responses": [ ... ],
  "defaultResponses": [ ... ]
}
```

**`control-state`** (admin control room) returns:

```json
{
  "session": { ... },
  "slides": [{ "slideNumber", "title", "summary", "configured", "feedbackType" }],
  "participantCount": 0,
  "responseCount": 0,
  "currentSlideResponseCount": 0
}
```

### Participant flow (`/api/sessions/:code/join`)

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/sessions/:code/join` | none | `{ name, email }` | `{ participantId, sessionCode, status, currentSlide }` (201) | 404 `NOT_FOUND`; 409 `SESSION_ENDED` |

Validates `name` non-empty and `email` via Zod `z.string().email()`. Uses
`INSERT ... ON CONFLICT(session_id, email) DO UPDATE SET name` — the same
email rejoining a session gets the existing `participantId` with an updated
name. On success, if the session is `live`, broadcasts updated stats to admin
clients.

### Feedback (`/api/sessions/:code/feedback`)

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/sessions/:code/feedback` | none | `{ participantId, slideNumber, response }` | `StoredResponse` (201) | 400 `RESPONSE_REQUIRED` / `INVALID_*` / `SLIDE_NOT_FOUND`; 404 `NOT_FOUND` / `PARTICIPANT_NOT_FOUND`; 409 `SESSION_NOT_LIVE` / `NOT_CURRENT_SLIDE` / `RESUBMISSION_NOT_ALLOWED` / `FEEDBACK_DISABLED` |
| GET | `/api/sessions/:code/feedback/me` | none | query `participantId` | `{ responses }` (ordered by slide number) | 404 `NOT_FOUND` |

`POST` submission rules (in order):
1. Session exists and is `live`.
2. Participant exists and belongs to this session.
3. `slideNumber` equals the session's current slide.
4. The slide is configured and its rule exists; otherwise `SLIDE_NOT_FOUND`.
5. The rule must be enabled (else `FEEDBACK_DISABLED`) and the value must
   validate (see [Validation rules](#validation-rules)).
6. Insert, or update if a response already exists — but only when
   `allow_resubmission` is true, else `RESUBMISSION_NOT_ALLOWED` (409).

The `feedback_type` and `question` are snapshotted onto the response row from
the rule at submit time. After a successful submit, stats are broadcast to
live clients.

### Default questions & responses

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/sessions/:code/feedback/default` | none | `{ participantId, defaultQuestionId, slideNumber, response }` | `StoredDefaultResponse` (201) | 400 `RESPONSE_REQUIRED` / `INVALID_CHOICE` / `INVALID_RATING` / `SLIDE_OUT_OF_RANGE`; 404 `NOT_FOUND` / `PARTICIPANT_NOT_FOUND`; 409 `SESSION_NOT_LIVE` / `NOT_CURRENT_SLIDE` |
| GET | `/api/sessions/:code/default-feedback/me` | none | query `participantId` | `{ responses }` | 404 `NOT_FOUND` |

Submission rules mirror slide feedback, with extra checks: the question must
exist, belong to the same presentation, and target the current slide. Unlike
slide feedback, resubmission is always allowed (upsert by
`(participant_id, default_question_id, slide_number)`).

### Export (`/api/sessions/:code/export`)

Admin only. Returns a single JSON document with everything for the session:

```json
{
  "session": { "code", "presentation", "status" },
  "feedback": [
    { "slideNumber", "user": { "name", "email" }, "question", "feedbackType", "response", "submittedAt" }
  ],
  "defaultQuestions": [
    { "id", "questionText", "questionType", "targetSlides" }
  ],
  "defaultFeedback": [
    { "slideNumber", "user": { "name", "email" }, "question", "questionType", "response", "submittedAt" }
  ]
}
```

Both response lists are ordered by slide number then email; default feedback
additionally by question creation time.

### WebSocket (`/ws/session/:code`)

```
GET /ws/session/:code   (Upgrade: websocket)
```

`index.ts` derives a Durable Object ID from the session code
(`idFromName(code)`) and forwards the raw request. The DO (`PresentationSession`)
accepts the WebSocket and stores the server-side socket. The protocol is
**server → client only** — inbound messages are ignored.

---

## Real-time protocol

Messages are JSON strings sent by the DO's `broadcast()` to every connected
socket of that session.

**`SLIDE_CHANGED`** — sent on `start` and every slide change. Includes the
slide's own feedback rule plus any default questions targeting that slide:

```json
{
  "type": "SLIDE_CHANGED",
  "slideNumber": 4,
  "slide": { "slideNumber": 4, "title": "...", "summary": "..." },
  "feedbackRule": {
    "enabled": true,
    "required": true,
    "type": "multiple_choice",
    "question": "...",
    "options": ["..."],
    "allowResubmission": false
  },
  "defaultQuestions": [
    { "id": "...", "questionText": "Interested?", "questionType": "interested" }
  ]
}
```

For slides the admin never configured, `slide` is
`{ slideNumber, title: null, summary: null }` and `feedbackRule` is
`{ enabled: false, required: false, type: 'disabled', question: null, options: null, allowResubmission: false }`
(default questions still attach).

**`SESSION_ENDED`** — sent on `end`:

```json
{ "type": "SESSION_ENDED" }
```

**`SESSION_STATS_UPDATED`** — sent to live clients after a join or a
successful feedback submission (no PII, just aggregates):

```json
{ "type": "SESSION_STATS_UPDATED", "participantCount": 12, "currentSlideResponseCount": 8 }
```

Broadcasts are triggered by the service layer via an internal POST to the DO's
`/broadcast` endpoint; the DO then fans the JSON out to its sockets.

---

## Validation rules

`src/validation/feedback.ts` defines the Zod schema and runtime validators.

**Feedback rule config** (`feedbackRuleConfigSchema`):

```ts
{
  enabled: boolean,
  required: boolean,
  feedbackType: 'disabled' | 'boolean' | 'multiple_choice' | 'open_text',
  question?: string,
  options?: string[],
  allowResubmission: boolean
}
```

Super-refine: if `feedbackType === 'multiple_choice'`, `options` must be a
non-empty array with no blank entries.

**Response validation** (`validateResponse(rule, rawValue)`):
- Rule must be `enabled` and not `disabled` → else `FEEDBACK_DISABLED`.
- Empty value: allowed unless `required` → `RESPONSE_REQUIRED`.
- `boolean` → must be `yes` or `no` → else `INVALID_BOOLEAN`.
- `multiple_choice` → must be one of the configured options → else `INVALID_CHOICE`.
- `open_text` → trimmed, ≤ 2000 chars → else `RESPONSE_TOO_LONG`.
- `disabled` → `FEEDBACK_DISABLED`.

**Default question validation** (`validateDefaultResponse(questionType, rawValue)`):
- Empty → `RESPONSE_REQUIRED`.
- `interested` → `interested` or `not_interested` → else `INVALID_CHOICE`.
- `rating` → integer 0–10 (string-form) → else `INVALID_RATING`.

**Request body schemas** (Zod, per route):
- `joinSchema`: `{ name: string.min(1), email: string.email() }`.
- `feedbackSchema`: `{ participantId: string.min(1), slideNumber: int.min(1), response: string }`.
- `defaultFeedbackSchema`: adds `defaultQuestionId: string.min(1)`.
- `slideSchema` (slide change): `{ slideNumber: int.min(1) }`.
- `createSchema` (session): `{ presentationId: string.min(1) }`.
- `defaultQuestionSchema`: `{ questionText: string.min(1), questionType: 'interested'|'rating', targetSlides: int.min(1)[] min(1) }`.
- `putSlideSchema`: `{ title?: string, summary: string.min(1), feedbackRule }`.

Malformed/unknown bodies fail with `400 { error: 'VALIDATION_ERROR', issues }`.

---

## Error codes

Backend responses use `{ error: '<CODE>' }` (Zod failures add `issues`). All
codes used across routes:

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Admin guard rejected the request |
| `INVALID_CREDENTIALS` | 401 | Wrong admin password |
| `NOT_FOUND` | 404 | Session, presentation, slide, participant, question, or export target missing |
| `PARTICIPANT_NOT_FOUND` | 404 | Participant ID unknown or not in this session |
| `SLIDE_NOT_FOUND` | 404 | Slide row missing for the submission target |
| `VALIDATION_ERROR` | 400 | Zod parse failure (body or required query) |
| `TITLE_REQUIRED` | 400 | Upload missing title |
| `INVALID_SLIDE_COUNT` | 400 | Slide count not a positive integer |
| `FILE_REQUIRED` | 400 | Upload missing file |
| `INVALID_FILE_TYPE` | 400 | File not `.pptx` |
| `FILE_TOO_LARGE` | 400 | File > 50 MB |
| `INVALID_SLIDE_NUMBER` | 400 | Path slide number not a positive integer |
| `SLIDE_OUT_OF_RANGE` | 400 | Slide number outside `1..slide_count` (change or default-question target) |
| `RESPONSE_REQUIRED` | 400 | Empty response on a required field |
| `INVALID_BOOLEAN` | 400 | `boolean` answer not `yes`/`no` |
| `INVALID_CHOICE` | 400 | `multiple_choice` / `interested` answer not an option |
| `INVALID_RATING` | 400 | Rating not an integer 0–10 |
| `RESPONSE_TOO_LONG` | 400 | `open_text` over 2000 chars |
| `FEEDBACK_DISABLED` | 400/409 | Rule not enabled (validation) |
| `PRESENTATION_NOT_FOUND` | 404 | Session created for unknown presentation |
| `SESSION_ENDED` | 409 | Join/start on an ended session |
| `SESSION_NOT_LIVE` | 409 | Control/feedback action on a non-live session |
| `NOT_CURRENT_SLIDE` | 409 | Feedback for a slide that isn't the current one |
| `RESUBMISSION_NOT_ALLOWED` | 409 | Duplicate response with `allow_resubmission` false |
| `CODE_GENERATION_FAILED` | 500 | 5 session-code collisions in a row |

---

## Services layer

Thin data-access layer between routes and D1/R2/DO. Each file owns its tables.

| Service | Owns | Key functions |
|---|---|---|
| `presentationService` | `presentations` + R2 | `createPresentation` (R2 put + insert), `getPresentation`, `listPresentations` (with `configuredSlides` + `latestSession` aggregates) |
| `slideService` | `slides` + `feedback_rules` | `upsertSlide` (both rows in one tx-ish flow, `ON CONFLICT`), `listSlides`, `getSlideByNumber` (always LEFT JOINs the rule) |
| `sessionService` | `presentation_sessions` | `getSession` (joins title/slide count), `createSession` (code gen with retry), `startSession`, `changeSlide`, `endSession`, `currentSlideEvent`, `listSessions`, `getControlState`, `broadcastStats`; builds `SLIDE_CHANGED` payloads incl. default questions; notifies the DO via `notifyDO` |
| `participantService` | `participants` | `joinSession` (upsert by email), `getParticipant` |
| `feedbackService` | `feedback_responses` | `submitFeedback` (full rule validation + resubmission policy + snapshot), `getMyFeedback` |
| `defaultQuestionService` | `default_questions` | `listDefaultQuestions`, `getDefaultQuestionsForSlide` (in-memory filter on `targetSlides`), `getDefaultQuestionById`, `createDefaultQuestion`, `deleteDefaultQuestion` |
| `defaultResponseService` | `default_responses` | `submitDefaultResponse` (upsert, always allowed), `getMyDefaultFeedback` |
| `exportService` | read-only across tables | `exportSession` (three queries: slide feedback, default questions, default responses) |

### Durable Object (`PresentationSession`)

Per session code (`idFromName(code)`). Behavior:

- **WebSocket upgrade** — accepts the connection, keeps the server socket.
- **POST `/broadcast`** — internal control message; `broadcast()` serializes
  and sends to every open socket, swallowing per-socket send errors.
- Inbound WS messages are ignored (POC is server → client only); close/error
  handlers clean up the socket.

---

## Utilities

| Module | Exports | Purpose |
|---|---|---|
| `utils/auth.ts` | `signToken`, `verifyToken`, `adminGuard` | HMAC-signed admin token + Access-aware middleware |
| `utils/common.ts` | `bytesToB64url`, `b64urlToBytes`, `strToB64url`, `b64urlToStr`, `hmacSign`, `hmacVerify`, `newId`, `now` | base64url + WebCrypto HMAC-SHA256 + UUID/ISO helpers |
| `utils/sessionCode.ts` | `generateSessionCode` | 6-char code from an unambiguous alphabet via `crypto.getRandomValues` |

---

## Scripts

From `worker/package.json` (run with `pnpm --filter worker <script>`):

| Script | Command | Purpose |
|---|---|---|
| `dev` | `wrangler dev` | Local dev server (:8787) |
| `deploy` | `wrangler deploy` | Deploy to Cloudflare |
| `typecheck` | `tsc --noEmit` | Type check |
| `db:create` | `wrangler d1 create live-feedback-db` | Create remote D1 DB |
| `db:migrate:local` | `wrangler d1 migrations apply DB --local` | Apply migrations to local D1 |
| `db:migrate:remote` | `wrangler d1 migrations apply DB --remote` | Apply migrations to remote D1 |
