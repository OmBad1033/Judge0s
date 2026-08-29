# Backend Change Plan — UX-Supporting API Additions

> **Purpose:** Tell your backend agent exactly what API/real-time changes the new UI requests, prioritized so the visual redesign ships first. A later agent applies these per the contracts below. This document lists **additions only** — it does not redefine existing, working behavior.

---

## 1. Priority Model

| Priority | Meaning | Blocks UI? |
|----------|---------|------------|
| **P0** | No backend change. Pure frontend (visuals, copy-to-clipboard, confirmations, skeletons, empty states, toasts, blank-slide UX, JSON download). | — |
| **P1** | Recommended for a complete UX (discovery + reconnect-safe hydration). The new UI degrades gracefully without it. | No |
| **P2** | Optional live-control enhancements (real-time counts). Omit if out of POC scope; UI polls or hides. | No |

**Baseline rule:** The Stitch UI can be generated, reviewed, and integrated using **only P0 + existing contracts**. P1/P2 are enhancements.

---

## 2. Current Baseline (must preserve)

### Existing endpoints (do not change)
| Method & path | Auth | Purpose |
|---------------|------|---------|
| `POST /api/admin/login` `GET /api/admin/me` `POST /api/admin/logout` | cookie | Admin auth |
| `POST /api/presentations` (multipart) | admin | Upload `.pptx` → R2 + D1 |
| `GET /api/presentations/:id` | admin | Fetch one presentation |
| `GET /api/presentations/:id/slides` | admin | List slides + rules |
| `PUT /api/presentations/:id/slides/:slideNumber` | admin | Upsert slide content + rule |
| `POST /api/sessions` `{presentationId}` | admin | Create draft session |
| `GET /api/sessions/:code` | public | Session status/slide |
| `POST /api/sessions/:code/start` | admin | → live, slide 1 |
| `PATCH /api/sessions/:code/slide` `{slideNumber}` | admin | Navigate |
| `POST /api/sessions/:code/end` | admin | → ended |
| `GET /api/sessions/:code/current-slide` | public | Canonical slide event |
| `POST /api/sessions/:code/join` `{name,email}` | public | Upsert participant → participantId |
| `POST /api/sessions/:code/feedback` `{participantId,slideNumber,response}` | public | Submit (validated, resubmission-enforced) |
| `GET /api/sessions/:code/feedback/me?participantId=` | public | This participant's responses |
| `GET /api/sessions/:code/export` | admin | Structured JSON |
| `GET /ws/session/:code` | public | WebSocket fan-out |

### Existing real-time events (do not change)
- `SLIDE_CHANGED` → `{ slideNumber, slide:{slideNumber,title,summary}, feedbackRule:{enabled,required,type,question,options,allowResubmission} }`
- `SESSION_ENDED` → `{}`
- Blank/unconfigured slide: `SLIDE_CHANGED` with `slide.title=null, slide.summary=null, feedbackRule.type='disabled'`.

### Behavior that must remain
- **Unconfigured slides never block** start/navigation (no `SLIDE_NOT_CONFIGURED`); they yield the blank payload above.
- Session lifecycle: `draft → live → ended`; ended rejects joins and slide changes.
- Feedback validation + resubmission upsert/reject is **server-authoritative**.
- D1 is the source of truth; Durable Object is fan-out only.
- Field naming: REST config uses `feedbackType`; WS/current-slide rules use `type` — keep both.

### Files of record
`worker/src/routes/{auth,presentations,sessions,slides}.ts`, `worker/src/services/{presentation,session,slide,participant,feedback,export}Service.ts`, `worker/src/durable-objects/PresentationSession.ts`, `worker/src/validation/feedback.ts`, `worker/src/db/migrations/0001_init.sql`.

---

## 3. P1 — Recommended Additions

### 3.1 Presentation Library → `GET /api/presentations`

**Why:** Admin dashboard needs to list existing presentations instead of only being able to upload.

| | |
|---|---|
| Method/Path | `GET /api/presentations` |
| Auth | admin |
| Query (optional) | none |
| Success 200 | `{ presentations: PresentationSummary[] }` |
| Errors | 401 `UNAUTHORIZED` |
| Frontend consumer | `frontend/src/api.ts` → `api.listPresentations()`; `types.ts` → `PresentationSummary` |

**`PresentationSummary`:**
```jsonc
{
  "id": "uuid",
  "title": "Product Demo",
  "originalFilename": "demo.pptx",
  "slideCount": 8,
  "createdAt": "ISO",
  "configuredSlides": 5,          // count of slides with a row in `slides`
  "latestSession": {              // null if none
    "sessionCode": "ABX729",
    "status": "ended",            // draft|live|ended
    "currentSlideNumber": 8
  } | null
}
```

**Implementation notes:**
- Files: `worker/src/routes/presentations.ts` (route), `worker/src/services/presentationService.ts` (`listPresentations`).
- Derive `configuredSlides` via `SELECT COUNT(*) FROM slides WHERE presentation_id=?`.
- Derive `latestSession` via a single query ordered by `created_at DESC LIMIT 1` joined to `presentation_sessions`.
- **No migration.** Pure joins/aggregates over existing tables.
- Pagination is **out of POC scope**; return all (cap with a sensible LIMIT if worried, e.g., 100).

---

### 3.2 Session Discovery → `GET /api/sessions?presentationId=<id>`

**Why:** Admin needs to reopen a past/live session for a presentation and see history.

| | |
|---|---|
| Method/Path | `GET /api/sessions?presentationId=<id>` |
| Auth | admin |
| Success 200 | `{ sessions: SessionListItem[] }` ordered by `created_at DESC` |
| Errors | 400 `VALIDATION_ERROR` (missing presentationId), 401 `UNAUTHORIZED` |

**`SessionListItem`:**
```jsonc
{
  "sessionCode": "ABX729",
  "status": "ended",
  "currentSlideNumber": 8,
  "createdAt": "ISO",
  "startedAt": "ISO" | null,
  "endedAt": "ISO" | null,
  "presentationTitle": "Product Demo"
}
```

**Implementation notes:**
- Files: `worker/src/routes/sessions.ts`, `worker/src/services/sessionService.ts` (`listSessions`).
- Reuse `getSession`'s join shape; filter by `presentation_id`.
- **No migration.**

> **Canonical choice:** Implement **3.1 and 3.2** (recommended). A simpler alternative is to fold `latestSession` into 3.1 only and skip 3.2 — pick one in implementation; the UI degrades either way.

---

### 3.3 Participant Bootstrap → `GET /api/sessions/:code/participant-state?participantId=<id>`

**Why:** On refresh/reconnect, the participant must atomically know session status, the current slide event, and their existing response for the current slide — avoiding the race between `current-slide` and `feedback/me`.

| | |
|---|---|
| Method/Path | `GET /api/sessions/:code/participant-state?participantId=<id>` |
| Auth | public (validates participant belongs to session) |
| Success 200 | `ParticipantState` (below) |
| Errors | 404 `NOT_FOUND` (session or participant mismatch), 409 `SESSION_ENDED` |

**`ParticipantState`:**
```jsonc
{
  "session": { "sessionCode":"ABX729", "status":"live", "presentationTitle":"Product Demo", "currentSlideNumber": 3 },
  "event": <SlideEvent>,                 // canonical current slide event (SLIDE_CHANGED blank included)
  "existingResponse": {                   // null if none for the current slide
    "id":"...", "slideNumber":3, "feedbackType":"boolean",
    "question":"Was it clear?", "responseValue":"yes", "submittedAt":"ISO"
  } | null,
  "responses": [ <StoredResponse>, ... ]  // all prior responses (for local cache/prefill)
}
```

**Implementation notes:**
- Files: `worker/src/routes/sessions.ts` (route), `worker/src/services/sessionService.ts` + `participantService.ts` + `feedbackService.ts` (compose).
- Reuse `currentSlideEvent` for `event`; reuse `getMyFeedback` for `responses`; add a single-row lookup for `existingResponse` filtered by current slide.
- Validate participant belongs to session (reuse existing check).
- For ended sessions: return status `ended` + `event` last-known; participant UI goes terminal.
- **No migration.**
- Frontend `usePresentationSocket` stays for live updates; this endpoint only seeds initial state and is called once on mount.

---

## 4. P2 — Optional Live-Control Enhancements

### 4.1 Control-Room State → `GET /api/sessions/:code/control-state`

**Why:** Admin control room shows connected participant count and response tallies.

| | |
|---|---|
| Method/Path | `GET /api/sessions/:code/control-state` |
| Auth | admin |
| Success 200 | `ControlState` (below) |
| Errors | 404 `NOT_FOUND`, 401 `UNAUTHORIZED` |

**`ControlState`:**
```jsonc
{
  "session": <Session>,
  "slides": [ { "slideNumber":1, "title":"Intro", "summary":"...", "configured":true, "feedbackType":"disabled"|"boolean"|... } ], // summaries for all slides
  "participantCount": 12,
  "responseCount": 9,                       // total across session
  "currentSlideResponseCount": 7           // responses for currentSlideNumber
}
```

**Implementation notes:**
- Files: `worker/src/routes/sessions.ts`, `worker/src/services/sessionService.ts` (`getControlState`).
- `participantCount`: `SELECT COUNT(*) FROM participants WHERE session_id=?`.
- `responseCount`/`currentSlideResponseCount`: aggregates over `feedback_responses` (join `slides` for current-slide filter).
- `slides` summary: reuse `listSlides` + mark configured.
- **No migration.** Derive from existing tables.
- Candidate index only if a query plan shows a scan: `CREATE INDEX idx_responses_session ON feedback_responses(session_id);` — verify before adding; document separately.

---

### 4.2 Live Stat Events → `SESSION_STATS_UPDATED` (WebSocket)

**Why:** Real-time count updates without polling.

**Event:**
```jsonc
{ "type":"SESSION_STATS_UPDATED", "participantCount":12, "currentSlideResponseCount":7 }
```

**Implementation notes:**
- Broadcast from the Durable Object after join and after feedback submission.
- Contains **aggregate counts only — never participant PII**.
- Requires the admin to be connected to the same DO (admin opens `/ws/session/:code` too) OR a separate admin WS. Keep within POC: have the admin control-room page open the existing WS and listen for `SESSION_STATS_UPDATED` alongside `SLIDE_CHANGED`/`SESSION_ENDED`.
- Triggers:
  - `POST /api/sessions/:code/join` → after upsert, `notifyDO(... STATS_UPDATED)`.
  - `POST /api/sessions/:code/feedback` → after insert/update, `notifyDO(... STATS_UPDATED)`.
- Compute counts server-side (D1) before broadcasting; DO stays fan-out only.
- **Fallback if not implemented:** frontend polls `GET /control-state` every ~5s while live. Document the poll interval and that it stops when ended.

---

## 5. Optional: Error Envelope (compatibility-safe)

Current errors are `{ "error": "CODE" }` (+ `issues` for validation). Recommend an additive, backward-compatible envelope for friendlier UI:

```jsonc
{ "error": "RESUBMISSION_NOT_ALLOWED", "message": "You can't change your response for this slide." }
```

- `message` is optional and human-facing; clients ignore it safely.
- Keep `error` codes stable; do not rename existing ones.
- `VALIDATION_ERROR` keeps its `issues` array.
- **Not required** — the frontend can map codes to messages itself (see §6).

---

## 6. Error Code → UX Message Mapping (frontend reference)

| Code | HTTP | UX message (suggested) |
|------|------|--------------------------|
| `UNAUTHORIZED` / 401 | 401 | "Please log in again." → redirect to login |
| `INVALID_CREDENTIALS` | 401 | "Invalid password." |
| `NOT_FOUND` | 404 | "We couldn't find that." |
| `VALIDATION_ERROR` | 400 | per-field issues |
| `SESSION_ENDED` | 409 | "This session has ended." |
| `SESSION_NOT_LIVE` | 409 | "The session isn't live right now." |
| `SLIDE_OUT_OF_RANGE` | 400 | "That slide number is out of range." |
| `NOT_CURRENT_SLIDE` | 409 | (silent) refresh to current slide |
| `PARTICIPANT_NOT_FOUND` | 404 | "Your join expired — please rejoin." → `/join?code=` |
| `FEEDBACK_DISABLED` | 400 | "Feedback is disabled for this slide." |
| `RESPONSE_REQUIRED` | 400 | "A response is required." |
| `INVALID_BOOLEAN` | 400 | "Please choose Yes or No." |
| `INVALID_CHOICE` | 400 | "Please pick one of the options." |
| `RESPONSE_TOO_LONG` | 400 | "Response is too long (max 2000 chars)." |
| `RESUBMISSION_NOT_ALLOWED` | 409 | "You can't change your response for this slide." |
| `FILE_TOO_LARGE` / `INVALID_FILE_TYPE` / `FILE_REQUIRED` | 400 | upload-specific |

---

## 7. Data & Migration Assessment

- **No D1 migration required** for any P1/P2 change. All data already exists in: `presentations`, `slides`, `feedback_rules`, `presentation_sessions`, `participants`, `feedback_responses`.
- All new fields (`configuredSlides`, counts, `latestSession`) are **derived** via joins/aggregates.
- Add an index **only** with query-plan evidence; candidate: `feedback_responses(session_id)`. Document any index added in a new migration file (e.g., `0002_indexes.sql`) with a comment explaining the query it optimizes — do not assume it's needed.
- R2 and Durable Object bindings are unchanged.

---

## 8. Implementation Tasks (ordered)

1. **`listPresentations`** (P1, §3.1) — route + service; derive configured count + latest session.
2. **`listSessions`** (P1, §3.2) — route + service; filter by presentation.
3. **`participantState`** (P1, §3.3) — route + composed service; atomic bootstrap.
4. **`getControlState`** (P2, §4.1) — route + service; counts + slide summaries.
5. **`SESSION_STATS_UPDATED`** (P2, §4.2) — DO broadcast triggers in join + feedback services; admin WS listener.
6. **(Optional) error `message`** (§5) — additive; touch each route's error responses if adopted.

For each task: name the file, add the route handler, add the service function, reuse existing mappers, keep status codes consistent, and update the frontend `api.ts`/`types.ts` consumers (listed in each contract).

---

## 9. Security & Runtime Constraints

- Admin endpoints stay behind `adminGuard` (cookie).
- Public participant endpoints validate session existence and participant membership.
- No new credentials/secrets; no PII in WebSocket events (P2 counts are aggregate only).
- Workers-compatible APIs only; no persistent process/filesystem assumptions.
- Upload limits (`50MB`, `.pptx`) unchanged.
- No new infrastructure; no PPT rendering; no QR; no analytics; no accounts.

---

## 10. Verification

- `pnpm --filter worker typecheck`
- `pnpm build`
- Apply local migrations only if an index was added: `pnpm --filter worker db:migrate:local`.
- API happy paths: list presentations; list sessions by presentation; participant-state bootstrap; control-state counts.
- Invalid: unauth admin endpoints; participant-state for wrong session; control-state on nonexistent code.
- Multi-participant correctness: 3 joins → `participantCount=3`; submissions → `responseCount`/`currentSlideResponseCount` correct.
- Reconnect: refresh participant → `participant-state` restores current slide + existing response.
- If P2 stats omitted: confirm frontend polls `control-state` while live and stops when ended.
- Confirm unconfigured slides still never block (blank payload, no `SLIDE_NOT_CONFIGURED`).

---

## 11. Handoff Contract (summary)

| Endpoint/Event | Priority | New? | Auth | Frontend consumer |
|----------------|----------|------|------|-------------------|
| `GET /api/presentations` | P1 | yes | admin | library screen |
| `GET /api/sessions?presentationId=` | P1 | yes | admin | session discovery |
| `GET /api/sessions/:code/participant-state` | P1 | yes | public+membership | participant bootstrap |
| `GET /api/sessions/:code/control-state` | P2 | yes | admin | control room stats |
| `SESSION_STATS_UPDATED` (WS) | P2 | yes | public | admin control room live counts |
| `error.message` (additive) | optional | yes | — | friendlier messages |

**Frontend edits required when backend lands:** update `frontend/src/api.ts` (new methods) and `frontend/src/types.ts` (`PresentationSummary`, `SessionListItem`, `ParticipantState`, `ControlState`, WS event union). `usePresentationSocket.ts` gains a `SESSION_STATS_UPDATED` case if P2 is implemented.

**Baseline guarantee:** Until P1/P2 land, the Stitch UI ships on P0 + existing contracts; the library uses an empty/teaching state, and control-room counts are gracefully omitted.
