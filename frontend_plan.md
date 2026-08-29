# Frontend Plan — Live Feedback Platform

Companion to `backend_plan.md` / `ARCHITECTURE.md`. Read those first for the API/WS contracts referenced below.

**Device priority — the core constraint for this whole plan:**

| Persona | Context | Priority |
|---|---|---|
| Admin, *configuring* an event (upload PPT, build forms, invite co-admins) | At a desk, laptop/desktop | **Desktop-first**, must still be usable on tablet |
| Admin, *running* a live session | Standing in a room, phone in hand | **Mobile-first**, this is the screen they'll actually use most |
| Participant, all flows | Their own phone, joining from a link/QR/code | **Mobile-first**, treat desktop as a bonus, not a target |

So: two distinct UI modes for admins (a "workbench" desktop mode for setup, a "remote control" mobile mode for live running), and one fully mobile-first participant app. This should be reflected in the actual layout components, not just responsive CSS tweaks — the live-control screen and the config screen are different enough that they deserve different navigation shells (see §3).

---

## 1. Recommended stack

- **React + TypeScript**, served as Cloudflare Static Assets from the same Worker (matches current build — one deployable unit).
- **Tailwind CSS + shadcn/ui** — utility-first and touch-target-friendly out of the box; easy to keep desktop config screens and mobile live screens visually consistent without two design systems.
- **TanStack Query** for all REST calls (caching, retry, background refetch — useful for the "reconnect on mobile" case).
- **A single `useSessionSocket` hook** wrapping the WebSocket connection to a session's Durable Object: handles connect, the `GET /sessions/:id/state` REST fallback on reconnect (see `backend_plan.md` addendum), and re-subscribing after the OS backgrounds the browser tab.
- **React Router**, with an SPA catch-all so deep links like `/join/ABCD-12` work when opened fresh from a QR code or shared link.
- **`qrcode.react`** (generate) for the admin's session-code screen, **`html5-qrcode`** or the native `BarcodeDetector` API (scan) for the participant join screen.
- **PWA basics**: `manifest.json` + minimal service worker so participants and admins can "Add to Home Screen" — this is a genuinely useful feature here since both personas may reuse this app across many events.

---

## 2. Mobile-first design rules (apply everywhere, not just participant screens)

- Minimum touch target: 44×44px (Apple HIG) / 48×48dp (Material) — applies to every button, especially the admin's next/prev slide controls
- Single-column layouts by default; anything multi-column is a `md:`/`lg:` breakpoint enhancement, never the base layout.
- Bottom-anchored primary actions on mobile (submit button, next-slide button) — thumb-reachable, not top-of-screen.
- Bottom tab/nav bar for mobile live-control and participant modes; a top nav / sidebar only appears in the desktop config mode.
- Assume flaky connectivity: every screen that depends on live data needs a visible connection-status indicator and a defined "stale/reconnecting" state — not just a spinner.
- Large, legible type at arm's length — admins are often glancing at the phone while also looking at the room/audience.
- Respect safe areas (notch/home-indicator) via `env(safe-area-inset-*)` since this will frequently run as an installed PWA full-screen.

---

## 3. Navigation shells

**Desktop config shell** (admin, event setup): persistent left sidebar (Events, current event's Overview/Slides/Admins/Sessions tabs), top bar with user menu + super-admin badge if applicable.

**Mobile live-control shell** (admin, running a session): full-screen "remote control" layout — no sidebar. Top bar shows session code + connection status + participant count; bottom bar has Prev / Next / Pause-End as large touch targets; a slide-up sheet reveals live stats without leaving the control screen.

**Participant shell** (mobile-first, all flows): no persistent nav at all — this is a single-purpose, single-screen-at-a-time flow (join → wait → feedback → thank you). Avoid giving participants anywhere to get lost.

---

## 4. Full page inventory

Grouped by area, each with device priority and what it needs to display/do. "Phase" maps to the phase in `backend_plan.md` this page's data depends on.

### 4.1 Auth & account (responsive, mobile-usable but low-frequency)

| Page | Priority | Contents | Backend phase |
|---|---|---|---|
| **Login** | Responsive | Single "Continue with Google" button, minimal branding, works cleanly on a phone since a co-admin might accept an invite from their phone | Phase 1 |
| **Profile / Account menu** | Responsive | Name, email, avatar (from Google), logout, "You are a Super Admin" badge if applicable | Phase 1 |

### 4.2 Admin — dashboard & event setup (desktop-first)

| Page | Priority | Contents | Backend phase |
|---|---|---|---|
| **My Events (dashboard)** | Desktop-first, mobile-readable | Card/list of events the user admins: name, status (draft/configured/archived), session count, "create event" CTA. Super admins get a toggle to view *all* platform events. | Phase 2 |
| **Create Event** | Desktop-first | Name, description, initial save → redirect to Event Overview | Phase 2 |
| **Event Overview** | Desktop-first | Tabs: Overview / Slides / Admins / Sessions. Summary stats (slide count, total sessions, total responses across all sessions). Rename/archive/delete actions. | Phase 2 |
| **Presentation Upload** | Desktop-first | Drag-drop `.pptx` dropzone, upload progress bar, processing status (queued/processing/ready/failed), re-upload/replace flow with a warning about existing sessions referencing old slides | Phase 7 |
| **Slide List / Reorder** | Desktop-first | Drag-and-drop ordered list of slides, thumbnail-or-placeholder + title, click-through to per-slide config | Phase 2, 7 |
| **Slide Config / Form Builder** | Desktop-first | Per slide: summary/notes editor, ordered list of feedback fields with add/remove/reorder, field-type picker (boolean, single-select, multi-select, rating, NPS, text, textarea), options editor for select/rating types, required toggle, **live preview pane showing exactly what the participant will see on mobile** (this preview should literally render at a phone-width viewport inside the page) | Phase 3 |
| **Event Admins** | Desktop-first | List of current admins + roles, invite-by-email form, remove action | Phase 1 |
| **Event Settings** | Desktop-first | Rename, archive, delete (with confirmation + explanation that sessions/responses are retained on archive) | Phase 2 |

### 4.3 Admin — running a session (mobile-first — the important half of this app)

| Page | Priority | Contents | Backend phase |
|---|---|---|---|
| **Sessions List** | Responsive | Past + current sessions for an event: status, label, date, participant/response counts, "New Session" CTA (this is how "Session 2" gets created) | Phase 2 |
| **Session Pre-Live (Lobby)** | **Mobile-first** | Big session code, QR code (encodes the join URL), share buttons (copy link, native share sheet), live count of participants who've already joined and are waiting, "Start Session" primary CTA | Phase 2, 4 |
| **Live Control Room** | **Mobile-first** | Current slide's title + summary front and center, big Prev/Next buttons, Pause/End controls, live participant count + connection status, collapsible live-stats sheet (per-field response breakdown for the current slide, updates in real time), "jump to slide" quick picker for non-linear control | Phase 4 |
| **Live Stats Detail** | Mobile-first, desktop-enhanced | Full breakdown per slide/field (bar charts for select types, average/gauge for rating/NPS, response list for text) — same component reused later in the desktop analytics page at a larger size | Phase 4, 6 |
| **Session Ended / Summary** | Mobile-first | Final counts, "Export CSV" / "Export JSON" buttons, "Start a new session for this event" shortcut | Phase 6 |

### 4.4 Admin — analytics & export (desktop-first, occasional mobile glance)

| Page | Priority | Contents | Backend phase |
|---|---|---|---|
| **Event Analytics (cross-session rollup)** | Desktop-first | Combined stats across all sessions of an event, filter by session, per-slide/per-field charts, export combined CSV | Phase 6 |

### 4.5 Participant (mobile-first, every screen)

| Page | Priority | Contents | Backend phase |
|---|---|---|---|
| **Join** | **Mobile-first** | Large "Enter code" input (auto-uppercase, formatted like the code pattern) *and* a "Scan QR" button using the device camera; deep-link support so opening a shared/QR URL skips straight past this screen | Phase 2, 5 |
| **Name & Email Entry** | **Mobile-first** | Two large inputs, single primary CTA, minimal friction — this is the last thing between the participant and the content | Phase 2, 5 |
| **Waiting Room** | **Mobile-first** | "Waiting for the host to start…" state with light animation, auto-transitions the instant the session goes live (via WS) | Phase 4, 5 |
| **Live Slide + Feedback Form** | **Mobile-first — the core screen** | Slide title/summary at top, dynamically-rendered form below built from that slide's `feedback_fields` (same field-type set as the admin's builder), large submit button, per-field "submitted ✓" state, auto-advances when the admin changes slides, preserves the participant's own answer if they navigate back to a previous slide (via the state-fetch fallback) | Phase 3, 4, 5 |
| **Reconnecting banner (not a full page — an overlay state)** | Mobile-first | Non-blocking banner when the WS drops, auto-retry, falls back to `GET /sessions/:id/state` so the current slide is never stale even mid-reconnect | Phase 4 |
| **Session Ended / Thank You** | **Mobile-first** | Simple thank-you screen, optional "powered by" branding for SaaS visibility, no further action available | Phase 4, 5 |
| **Invalid/Expired Code** | Mobile-first | Clear error state distinguishing "code not found" vs. "session already ended" vs. "session hasn't started" (if you disallow early joining) | Phase 2, 5 |

### 4.6 Shared / cross-cutting components

- Global toast/notification system (invite sent, save succeeded, connection lost/restored).
- Connection-status indicator component (used on both admin live-control and participant screens).
- Loading skeletons for every data-driven page (avoid layout shift, especially on mobile).
- Error boundary + a friendly generic error page.
- 404 page (with a "scan a new code" shortcut for participant-side dead links).
- Empty states for "no events yet", "no sessions yet", "no admins invited yet".

---

## 5. Phasing (mirrors `backend_plan.md`, work in the matching pairs)

| Frontend phase | Pages delivered | Pairs with backend phase | Device priority |
|---|---|---|---|
| **F0** | Current baseline frontend (already built) | Phase 0 | — |
| **F1** | Login, Profile/Account menu | Phase 1 | Responsive |
| **F2** | My Events, Create Event, Event Overview shell, Sessions List, Session Pre-Live/Lobby (code+QR display) | Phase 2 | Desktop-first (dashboard) + Mobile-first (lobby) |
| **F3** | Slide List/Reorder, Slide Config/Form Builder (+ mobile preview pane) | Phase 3 | Desktop-first |
| **F4** | Live Control Room, Reconnecting banner, connection-status component, `useSessionSocket` hook | Phase 4 | **Mobile-first** |
| **F5** | Join, Name/Email Entry, Waiting Room, Live Slide+Feedback Form, Session Ended (participant), Invalid Code | Phase 5 | **Mobile-first** |
| **F6** | Live Stats Detail, Session Ended/Summary (admin), Event Analytics rollup, CSV/JSON export UI | Phase 6 | Mobile-first (in-session stats) + Desktop-first (full analytics) |
| **F7** | Presentation Upload (progress/status UI) | Phase 7 | Desktop-first |
| **F8** | PWA manifest + service worker, safe-area handling, Add-to-Home-Screen prompts, full mobile QA pass (real devices, throttled network), accessibility pass | Phase 8 | Mobile-first |
| **F9** *(optional, later)* | Public landing/marketing page, pricing page (if you productize this as multi-tenant SaaS beyond your own events) | — | Responsive |

---

## 6. Parallelization

Same shape as the backend plan, and deliberately pairable with it:

- **F1** can start immediately alongside Backend Phase 1.
- **F7** (upload UI) can start immediately, independent of everything else, alongside Backend Phase 7.
- **F2** starts once Backend Phase 2's endpoints exist (or against a mocked API contract earlier).
- **F3** (desktop, admin persona) and **F4** (mobile, admin persona) can be built by two different people/agent sessions in parallel once F2's shell exists — they touch almost entirely different components (form builder vs. live control room) even though both are "admin" screens.
- **F5** (participant, mobile) can start in parallel with F3/F4 as soon as the field-type schema (Phase 3) and WS message contract (Phase 4) are agreed on paper — the participant form-rendering component and the admin form-builder component should share the same field-type → input-component mapping, so define that mapping once, early, and have both F3 and F5 consume it.
- **F6** depends on F4/F5 producing real data to test the stats views against meaningfully.
- **F8** is a final cross-cutting pass, though PWA manifest work can be done as soon as F0/F1 exist.

**If you're running this with an AI agent one phase at a time:** do F1 → F7 (interleave, no shared files) → F2 → F3/F4 in parallel (different files/routes) → F5 → F6 → F8 — same rhythm as `backend_plan.md`.