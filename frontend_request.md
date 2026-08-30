# Frontend → Backend Requests

This file is maintained by the **frontend_fix** agent. Each item lists what the frontend wants
backend to add so the two branches can stay compatible. Items below are sized to be small,
additive, and non-breaking — frontend_fix writes the contract here; the **backend_fix** agent
implements the matching endpoint/migration; frontend_fix then consumes it once deployed.

> **Status key:** `requested` → not started · `agreed` → backend_fix confirmed it will build
> this · `shipped` → endpoint exists on backend_fix branch

## Coordination protocol

- **frontend_fix** appends new items here with `status: requested`.
- **backend_fix** picks items up one at a time, flips to `agreed` (with an expected branch/commit),
  then `shipped` once the endpoint is live on its branch.
- **frontend_fix** consumes `shipped` items as soon as it sees them — never before, since
  unreleased endpoints would be undefined behavior.

### FR-1 — Deep-link-friendly session lookup (status: shipped)

**Why:** Mobile-first participant flow needs `/join/:code` to resolve without a separate `GET /sessions/:code` round trip when a participant opens a shared link/QR. The `code` in the URL should be enough to fetch a tiny "is this joinable right now?" payload.

**Contract:**
- New endpoint: `GET /api/sessions/:code/join-info`
- Response (`200 OK`):
  ```json
  {
    "sessionCode": "ABCD-12",
    "status": "draft" | "live" | "ended",
    "presentationTitle": "Q3 Strategy Review",
    "joinable": true | false,
    "reason": null | "ENDED" | "NOT_FOUND"
  }
  ```
- `404` if the session does not exist (with `{ error: "NOT_FOUND" }`).
- Public — no auth required.
- Optional field `requiresEmail`: `false` by default. Phase 1 simplification: name + email is always required.

**Frontend impact:** `JoinSession.tsx` will fetch this on mount to render either the join form, a "session ended" state, or a "code not found" state — without trying to actually join yet.

**Out of scope:** OAuth for participants, rate-limiting (Phase 8).

### FR-2 — Resume-friendly session state for participants (status: shipped)

**Why:** Mobile networks drop WebSockets more often than desktop. The frontend wants a single cheap REST call that returns exactly what the participant needs to render the current slide + their own prior responses — already partially implemented as `/api/sessions/:code/participant-state` (P1 §3.3 in the current worker).

**What frontend wants:** confirm/expand the existing endpoint so the response also includes:
- `participantId` echo (so the client can verify its stored localStorage matches the server's view).
- `serverTime` (ISO string) for clock-skew debugging.
- `previousSlides`: array of `{ slideNumber, hasResponse }` so the client can show "you've already answered slides 1–3" indicators if/when implemented.

**Contract (additive only — no breaking changes):**
```json
{
  "session": { "sessionCode": "...", "status": "live", "presentationTitle": "...", "currentSlideNumber": 4 },
  "event": { "type": "SLIDE_CHANGED", "slideNumber": 4, "slide": {...}, "feedbackRule": {...}, "defaultQuestions": [...] },
  "existingResponse": { ... } | null,
  "responses": [ ... ],
  "defaultResponses": [ ... ],
  "serverTime": "2026-08-29T22:00:00.000Z",
  "previousSlides": [ { "slideNumber": 1, "hasResponse": true }, { "slideNumber": 2, "hasResponse": true }, ... ]
}
```

**Frontend impact:** `ViewSession.tsx` already calls this on mount. The new fields are optional — frontend will use them when present and gracefully ignore them otherwise.

### FR-3 — Live stats payload upgrade for the admin (status: shipped)

**Why:** The Live Control Room needs more than `participantCount` + `currentSlideResponseCount`. To power the per-slide response breakdown (Phase 4 admin analytics), backend should include per-field counts.

**Contract (additive — extend existing `SESSION_STATS_UPDATED` broadcast):**
```json
{
  "type": "SESSION_STATS_UPDATED",
  "participantCount": 42,
  "currentSlideResponseCount": 38,
  "totalResponseCount": 142,
  "currentSlide": {
    "slideNumber": 4,
    "fieldBreakdown": [
      { "fieldId": "slide-4-rule", "feedbackType": "multiple_choice", "counts": { "Option A": 12, "Option B": 20, "Option C": 6 } },
      { "fieldId": "default-q-1", "questionType": "rating", "average": 7.4, "count": 38 }
    ]
  }
}
```

**Frontend impact:** The Live Control Room will render a collapsible live-stats sheet that shows option counts and averages in real time. If the new fields are missing, frontend falls back to the existing two counters — never a regression.

**Out of scope:** Historical session analytics — that's `/api/sessions/:code/export` (Phase 6).

### FR-4 — Lightweight `pause` / `resume` endpoint passthrough (status: shipped)

**Why:** Phase 4 admin persona explicitly mentions a Pause button in the Live Control Room. Frontend already has the button stub but no matching backend endpoint.

**Contract:**
- `POST /api/sessions/:code/pause` — sets status `paused`, broadcasts `{ type: "SESSION_PAUSED", status: "paused" }`.
- `POST /api/sessions/:code/resume` — sets status `live`, broadcasts `{ type: "SESSION_RESUMED", status: "live", currentSlideNumber: ... }`.
- Both admin-only (`adminGuard`). Both return `404` if session does not exist, `409` if status is invalid for the transition (`ended`, etc.).
- DO behavior: on pause, stop broadcasting `SLIDE_CHANGED` events but keep sockets open; on resume, broadcast the current slide to all participants again so they re-sync if they missed anything.

**Frontend impact:** Adds two buttons to the Live Control Room. Wire to the existing `usePresentationSocket` reconnect path so a paused session shows a banner.

**Optional but nice:** a `SESSION_STATUS` broadcast on any status change (start/pause/resume/end), so participants see accurate state without polling.

### FR-5 — Server-side presence count instead of mock data (status: shipped)

**Why:** The current Control Room renders a "Participant_Node_Activity" table fed by deterministic mock data (`lib/mockParticipants.ts`). The real `participants` table already tracks who's joined; backend should expose a slim list for the admin.

**Contract:**
- New endpoint: `GET /api/sessions/:code/participants` (admin-only)
- Response (`200 OK`):
  ```json
  {
    "participants": [
      { "id": "p_abc123", "name": "Alice", "joinedAt": "2026-08-29T22:00:00.000Z", "lastSeenAt": "...", "hasCurrentSlideResponse": true, "totalResponses": 4 }
    ]
  }
  ```
- `404` if session does not exist.

**Frontend impact:** Replace `lib/mockParticipants.ts` import with a real `api.listSessionParticipants(code)` call that refetches on `SESSION_STATS_UPDATED`. Renders the table from real data — never mocks.

**Privacy note:** `email` is **not** returned here. The export endpoint (`/api/sessions/:code/export`) is where admins see emails. This endpoint is for presence/activity only.

### FR-6 — CSV export endpoint parity with JSON (status: shipped)

**Why:** Current frontend builds CSV client-side from the JSON export. Backend should own CSV so it can be reused for the future per-event rollup and so the frontend can stop duplicating that code.

**Contract:**
- `GET /api/sessions/:code/export?format=csv` returns `text/csv` with `Content-Disposition: attachment; filename="<code>-responses.csv"`.
- Same data shape as the JSON export, just pivoted into a flat table:
  ```
  session_code,session_status,slide_number,participant_name,participant_email,question,feedback_type,response,submitted_at,source
  ```
- Default (no `?format=`) stays as JSON — non-breaking.

**Frontend impact:** Replace the `toCSV` helper in `SessionResults.tsx` with a direct download link to `?format=csv`. One less client-side dependency.

### FR-7 — Health endpoint stability (status: shipped)

**Why:** Phase 8 hardening. `GET /api/health` currently runs `SELECT 1` — fine, but add a `service` name + version so frontend and any uptime probe can detect deployments.

**Contract (additive):**
```json
{ "status": "ok", "db": true, "service": "live-feedback-worker", "version": "0.1.0" }
```

**Frontend impact:** None (devtools only).

