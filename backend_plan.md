# Build Plan — Live Feedback Platform

Companion to [`ARCHITECTURE.md`](http://ARCHITECTURE.md) (read that first — it defines the schema, API surface, and DO design referenced below).

**How to use this file with an AI coding agent:** each phase is scoped to be handed to the agent as a single work order — it lists goal, tasks, deliverables, and exit criteria the agent can self-check against. Paste one phase at a time (or a whole parallel group — see §Parallelization) into the agent along with [`ARCHITECTURE.md`](http://ARCHITECTURE.md) as context.

---

## Addendum — backend adjustments to support a mobile-first frontend

`frontend_[plan.md](http://plan.md)` is mobile-first for both the admin's live-control screen and the entire participant experience (config stays desktop-oriented). That has a few small but real implications for this backend plan — folded into the phases above rather than as a new phase:

- **SPA deep-linking (Phase 1/8):** Static Assets must fall back to `index.html` for any non-`/api` path so a participant can open `/join/ABCD-12` (from a QR code or shared link) directly, not just `/`. Add this to Worker routing config in Phase 1.
- **Lightweight state-fetch fallback (Phase 4):** mobile networks drop WebSockets more often than desktop (backgrounding, wifi↔cellular handoff). Add `GET /sessions/:id/state` (current slide + the calling participant's own prior responses) as a cheap REST fallback the client can call immediately on reconnect, before the WS handshake completes — avoids a blank/stale screen during the gap.
- `join_token` **lifetime (Phase 1/4):** make it long-lived enough (e.g. duration of the session + some buffer) that backgrounding the phone for a few minutes doesn't force re-entering name/email.
- **Response payload size (Phase 6):** keep `/sessions/:id/state` and live-stat broadcasts minimal (no full response history) — mobile data/battery matters for a screen that stays open for the whole live session.
- **No backend change needed for QR codes** — the QR simply encodes the join URL (`https://<app>/join/:session_code`); generation is entirely client-side.

---

## Phase 0 — Baseline (already done)

Your current prototype: Hono + Zod Worker, D1, R2, Durable Object slide sync, password/Cloudflare Access admin auth, slide config, question types, session create/start, participant join/submit, JSON export, Static Assets frontend.

This plan treats Phase 0 as the starting commit, not something to redo.

---

## Phase 1 — Auth overhaul (Google OAuth + Super Admin + Event Admins)

**Goal:** Replace password/Access admin auth with Google OAuth and the multi-admin-per-event model.

**Tasks**

- [ ] Implement `/auth/google/start` and `/auth/google/callback` (OAuth2 code exchange, verify `id_token`)
- [ ] `users` table + upsert-on-login; issue signed session JWT (cookie or bearer).
- [ ] `SUPER_ADMIN_EMAILS` env-based check, cache on [`users.is](http://users.is)_super_admin`.
- [ ] `event_admins` table; `requireEventAdmin(eventId)` middleware.
- [ ] `POST /events/:id/admins` (invite by email) / `DELETE .../admins/:userId`.
- [ ] `GET /auth/me` returning user + super admin flag + event memberships.
- [ ] Migrate any existing hardcoded/password admin routes to the new middleware.

**Deliverables:** working Google login end-to-end, at least one super admin able to log in, an admin able to invite a second admin to an event.

**Depends on:** nothing (foundational). **Blocks:** Phase 2's admin-scoped endpoints, all admin-only UI.

---

## Phase 2 — Event & Session core data model

**Goal:** Introduce `Event` as the persistent container and `Session` as an independently-restartable run of it, per your "session 2 with different users" requirement.

**Tasks**

- [ ] `events`, `sessions` tables per schema in [`ARCHITECTURE.md`](http://ARCHITECTURE.md) §5 (migrate slides/presentation FKs from whatever currently points at a single presentation to point at `event_id`).
- [ ] `POST /events`, `GET /events`, `GET /events/:id`, `PATCH`, `DELETE`.
- [ ] `POST /events/:id/sessions` — generates unique `session_code`, status `pending`.
- [ ] Session lifecycle endpoints: `start` / `pause` / `resume` / `end`.
- [ ] `POST /sessions/join` (session_code → participant + join_token).
- [ ] Update `responses`/`participants` to be `session_id`-scoped (not event-scoped) with `event_id` denormalized per schema.

**Deliverables:** an admin can create an Event, start Session 1, end it, start Session 2 on the same Event, and see two independent participant/response sets.

**Depends on:** Phase 1 (needs `owner_id`/admin checks) — but schema/migration work can start in parallel using a stubbed "current user" until Phase 1 lands. **Blocks:** Phases 3, 4, 5, 6.

---

## Phase 3 — Slide configuration & dynamic form builder

**Goal:** Generalize feedback fields beyond the current hardcoded question types into an admin-configurable, ordered field list per slide.

**Tasks**

- [ ] `feedback_fields` table per schema (`field_type`, `options_json`, `is_required`, `config_json`).
- [ ] `PUT /events/:id/slides/:slideId/fields` (replace field set).
- [ ] `PUT /events/:id/slides/reorder`.
- [ ] Server-side validation of submitted `responses.value_json` against the field's `field_type`/`options_json` (Zod schema generated per field type).
- [ ] Admin UI: per-slide form builder (add/remove/reorder fields, pick type, set required, set options).

**Deliverables:** an admin can configure a slide with a mix of boolean, single-select, multi-select, rating, and free-text fields without a code change.

**Depends on:** Phase 2 (`slide_id`/`event_id` FKs). **Can run in parallel with:** Phase 4 (realtime), since it only needs the *schema* from Phase 2, not the finished DO.

---

## Phase 4 — Real-time layer hardening

**Goal:** Refactor the Durable Object into the `SessionRoom` design in [`ARCHITECTURE.md`](http://ARCHITECTURE.md) §7 — one instance per session, write-through to D1, hibernation-aware.

**Tasks**

- [ ] DO id derived from `session_id`; migrate off any single-shared-DO pattern if currently used.
- [ ] Implement `join` (validate `join_token`, register socket, resume state), `advance slide`, `pause/resume/end`, `submit response` message handlers.
- [ ] Write-through of every state change to D1 before/alongside broadcast.
- [ ] Live stats aggregation in-memory, broadcast to admin sockets only.
- [ ] Adopt WebSocket Hibernation API for idle `pending` sessions.
- [ ] Reconnect flow: participant reloading the page resumes into the correct current slide + sees their own prior answers.

**Deliverables:** slide changes propagate to all connected participants in real time; a participant refreshing mid-session doesn't lose state or double-submit.

**Depends on:** Phase 2 (session/slide schema stable). **Can run in parallel with:** Phase 3.

---

## Phase 5 — Participant experience

**Goal:** The join-by-code flow and live participant UI.

**Tasks**

- [ ] Join page: enter `session_code` + name/email → `POST /sessions/join` → store `join_token` → open WS.
- [ ] "Current slide" view rendering the admin-authored summary + the dynamic form from Phase 3's field schema.
- [ ] Optimistic submit with server confirmation; disable/lock fields once submitted if `is_required` semantics call for single-submission.
- [ ] Waiting/ended states (session `pending` → "waiting for host to start"; `ended` → thank-you screen).

**Deliverables:** a participant can join, watch slides advance live, and submit feedback per slide.

**Depends on:** Phase 4 (WS contract) — frontend work can start earlier against a mocked WS message shape defined in [`ARCHITECTURE.md`](http://ARCHITECTURE.md) §7.

---

## Phase 6 — Data export & analytics

**Goal:** Per-session and per-event(cross-session) export/reporting.

**Tasks**

- [ ] `GET /sessions/:id/export` (JSON + CSV).
- [ ] `GET /events/:id/export` (rollup across sessions, `session_label` column).
- [ ] Admin dashboard: per-slide response summaries (option counts, averages) sourced from D1 for historical sessions and from live DO stats for the active one.

**Deliverables:** admin can download a clean CSV per session and a combined CSV per event.

**Depends on:** Phase 2 (schema) and at least partial Phase 4/5 (to have real response data to test against).

---

## Phase 7 — PPT upload & slide rendering pipeline

**Goal:** Solidify the upload → slide extraction path; decide on the image-rendering approach from [`ARCHITECTURE.md`](http://ARCHITECTURE.md) §9.

**Tasks**

- [ ] `POST /events/:id/presentation` multipart upload → R2, `presentation_files` row, status `processing`.
- [ ] Slide/text/notes extraction into `slides` rows (order, title, presenter_notes).
- [ ] Decide & implement image strategy: skip (Phase 1 default) / embedded-thumbnail extraction / external render service.
- [ ] Handle re-upload (new version) without breaking existing sessions that reference old slide IDs.

**Deliverables:** uploading a `.pptx` reliably produces an ordered, editable slide list.

**Depends on:** nothing but R2 access + `event_id` existing — **independent of Phases 1–6**, can start immediately.

---

## Phase 8 — Hardening & production readiness

**Goal:** Cross-cutting production concerns.

**Tasks**

- [ ] Rate limiting on `/sessions/join` and `/responses`.
- [ ] `audit_log` table + writes on admin-mutating actions.
- [ ] CORS lockdown, JWT rotation/expiry, secret rotation runbook.
- [ ] Structured error codes audit (make sure Phase 1–7 additions follow the existing convention).
- [ ] Load test: one session, N simulated participants, confirm DO doesn't choke before D1 does.
- [ ] Backup/retention policy for D1 + R2 (esp. participant PII — name/email).

**Depends on:** everything above functionally existing (this is a final pass, though individual items like rate limiting on `/responses` can be done as soon as that endpoint exists).

---
