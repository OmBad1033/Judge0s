# Frontend Plan — Stitch UI Specification

> **Purpose:** Authoritative visual and UX specification for generating the Live Presentation Feedback UI in **Google Stitch**, reviewing/iterating it, and later integrating the generated output. This document describes *what to build and how it should look/feel* — it does not contain implementation code.

---

## 1. Product Summary

A real-time presentation feedback POC built entirely on Cloudflare. An **admin** uploads a `.pptx`, configures each slide's content and feedback rules, creates a live session with a 6-character code, controls slides in real time, and exports structured JSON feedback. **Participants** join with name/email/code, see the current slide and its feedback form live over WebSocket, submit responses, and enter a terminal state when the session ends.

**Primary UX promise:**
- Admin: confident, fast, professional control — never confused about what's configured or live.
- Participant: effortless, mobile-first, real-time, always knows what to do next.

**Out of scope (do NOT build):** QR codes, PPT/slide image rendering, analytics dashboards, charts, AI analysis, user accounts/RBAC, chat, reactions, comments, notifications, email, complex reporting.

---

## 2. Theme — "Luminous Slate"

A **light-first** design system. Professional, calm, modern, elegant. Not flat — uses soft depth through shadow and layering, but avoids heavy glassmorphism.

### 2.1 Color System

| Role | Token | Value | Usage |
|------|-------|-------|-------|
| Background / Base | `--bg` | `#F7F8FC` warm-cool mist | App background |
| Surface | `--surface` | `#FFFFFF` | Cards, panels |
| Surface Raised | `--surface-2` | `#FFFFFF` + shadow | Modals, dropdowns |
| Surface Subtle | `--surface-subtle` | `#F1F3FB` | Insets, table stripes, code box |
| Border | `--border` | `#E2E5F0` | Dividers, input borders |
| Border Strong | `--border-strong` | `#C9CEDE` | Focus rings, emphasized |
| Text Primary | `--text` | `#1A1D2E` deep slate | Headings, body |
| Text Secondary | `--text-muted` | `#5A6075` | Labels, captions |
| Text Tertiary | `--text-faint` | `#8A90A6` | Placeholders, meta |
| Primary (Indigo) | `--primary` | `#5B5BF6` | Primary buttons, links, focus |
| Primary Hover | `--primary-hover` | `#4A4AE0` | |
| Primary Subtle | `--primary-subtle` | `#EEF0FE` | Selected rail, soft fills |
| Secondary (Violet) | `--secondary` | `#8B5CF6` | Gradients, accents |
| Success | `--success` | `#16A34A` | Live badge, submitted |
| Success Subtle | `--success-subtle` | `#DCFCE7` | Live status bg |
| Warning | `--warning` | `#D97706` | Unsaved, reconnecting |
| Warning Subtle | `--warning-subtle` | `#FEF3C7` | |
| Danger | `--danger` | `#DC2626` | End, destructive, errors |
| Danger Subtle | `--danger-subtle` | `#FEE2E2` | Ended status, error bg |
| Accent Gradient | `--grad-hero` | `linear-gradient(135deg, #5B5BF6, #8B5CF6)` | Login hero, code box glow |
| Aurora Mesh | `--grad-aurora` | radial blobs `#EEF0FE`, `#F3E8FF`, `#E0F2FE` | Entry surfaces only |

**Contrast:** all text/surface combinations meet WCAG AA (4.5:1 body, 3:1 large).

### 2.2 Typography

Font stack: `Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Monospace for session code & data: `"JetBrains Mono", "SF Mono", ui-monospace, monospace`.

| Token | Size / Weight | Line Height | Usage |
|-------|---------------|-------------|-------|
| Display | 2rem / 700 | 1.15 | Session code, login title |
| H1 | 1.5rem / 700 | 1.2 | Page titles |
| H2 | 1.25rem / 700 | 1.25 | Section, slide title |
| H3 | 1.0625rem / 600 | 1.3 | Card titles |
| Body | 0.9375rem / 400 | 1.6 | Paragraphs, summaries |
| Body Strong | 0.9375rem / 600 | 1.6 | Emphasis |
| Small | 0.8125rem / 400 | 1.5 | Labels, captions |
| Caption | 0.6875rem / 600 uppercase | 1.4 | Eyebrows, overlines |
| Code | 1.75rem / 700 mono | 1.2 | Session code display |

### 2.3 Spacing, Radii, Elevation

- **Spacing scale (4px base):** `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
- **Radii:** inputs `8px`; cards `12px`; panels `16px`; pills/badges `999px`; code box `14px`.
- **Shadows:**
  - `--shadow-sm` `0 1px 2px rgba(26,29,46,.06)` (inputs)
  - `--shadow-md` `0 4px 12px rgba(26,29,46,.08)` (cards)
  - `--shadow-lg` `0 12px 32px rgba(26,29,46,.12)` (modals, code box)
  - `--shadow-focus` `0 0 0 3px rgba(91,91,246,.25)` (focus ring)

### 2.4 Layout Tokens

- **Max content width:** admin `1100px`; participant `560px`; results `1200px`.
- **Breakpoints:** `sm 640, md 768, lg 1024, xl 1280`.
- **Container padding:** `16px` mobile, `24px` ≥md, `32px` ≥lg.

### 2.5 Motion

- Durations: `fast 120ms`, `base 180ms`, `slow 280ms`.
- Easing: `cubic-bezier(.4,0,.2,1)` standard.
- Use motion for state transitions (badge pulse, skeleton shimmer, toast slide).
- **`prefers-reduced-motion`:** disable all non-essential animation; keep instant opacity-only transitions.
- Live badge: gentle 2s pulse on the dot; stop pulsing when reduced-motion.

---

## 3. Information Architecture & Route Matrix

All routes from `frontend/src/App.tsx`. Stitch must generate exactly these screens.

| Route | Screen | Primary user | Data required (existing contracts) | Primary action | Key states |
|-------|--------|-------------|--------------------------------------|----------------|------------|
| `/admin/login` | Admin Login | Admin | none | Authenticate | idle, submitting, error |
| `/admin/presentations` | Presentation Library | Admin | `GET /api/presentations` *(P1)* or empty-state | Upload / open / create session | empty, loaded, upload modal |
| `/admin/presentations/:id/configure` | Slide Configuration Workspace | Admin | `GET /api/presentations/:id`, `GET /api/presentations/:id/slides` | Edit slides, create session | loading, unsaved, saved, empty-config |
| `/admin/sessions/:code` | Session Lobby / Control Room | Admin | `GET /api/sessions/:code`, *(P2 control-state)* | Start / navigate / end | draft, live, ended, action-busy |
| `/admin/sessions/:code/results` | Results & Export | Admin | `GET /api/sessions/:code/export` | Review, download JSON | loading, empty, populated |
| `/join` | Participant Join | Participant | none | Join session | idle, submitting, validation, error |
| `/session/:code` | Participant Live Experience | Participant | `GET /api/sessions/:code/current-slide`, `GET /api/sessions/:code/feedback/me`, WS `/ws/session/:code` | View slide, submit feedback | waiting, active, submitted, reconnecting, blank-slide, ended |

**Baseline note:** The visual redesign (P0) needs **no backend changes**. Dependencies marked *P1* or *P2* are listed in `backend_change_plan.md`. Until those land, the library screen uses an empty/teaching state and control-room stats are omitted gracefully.

---

## 4. Design System Components

Each component below is a Stitch generation target with defined states. Stitch should produce these as a shared system first, before screen composition.

### 4.1 Buttons
- **Primary** (indigo fill, white text), **Secondary** (surface + border), **Ghost** (transparent, muted text), **Destructive** (danger fill). Sizes: `md` (default), `sm`, `lg`.
- States: default, hover, focus-visible (ring), active, disabled, loading (spinner + label), icon+label combos (Previous/Next arrows, Copy).
- Full-width on mobile primary actions.

### 4.2 Form Controls
- **Text input / textarea / select** with floating or top label, helper text, error text, `--danger-subtle` error ring.
- **Toggle switch** for boolean settings (required, allowResubmission, enabled).
- **Radio choice cards** for feedback answers (large touch targets, selected = primary-subtle fill + primary border).
- **Segmented control** for feedback type selection (Disabled / Yes-No / Choice / Text).
- **File dropzone** with drag-over state, file preview chip, validation errors.

### 4.3 Feedback & Status
- **Status badge:** pill with dot. Variants: `draft` (neutral), `live` (success + pulse dot), `ended` (danger).
- **Connection badge:** `connected` (success), `reconnecting…` (warning + spinner).
- **Toast notifications:** success (submitted), error (submission failed), info — top-center on mobile, bottom-right on desktop; auto-dismiss 4s; respect reduced-motion.
- **Inline status:** success/error text under actions.
- **Banner:** persistent reconnecting/offline bar at top of participant screen.
- **Skeleton loaders** for cards, tables, slide content.
- **Empty states** with icon, title, description, and primary CTA.

### 4.4 Data Display
- **Session code box:** large monospace, `--shadow-lg`, dashed primary border, copy button with "Copied" feedback.
- **Slide progress:** `Slide 3 / 8` with thin progress bar.
- **Data table** (results) → collapses to **stacked cards** on mobile.
- **Slide rail item:** number circle + title + status chip (configured/unconfigured/unsaved).
- **Stat tiles:** participant count, response count (control room, P2).

### 4.5 Overlays
- **Modal/dialog** for confirmations (start, end) and upload form.
- **Drawer** (right on desktop, bottom sheet on mobile) for slide rail and participant preview when collapsed.

### 4.6 Shell
- **AdminShell:** sticky top nav (brand left, nav links center on desktop, logout right), content area, responsive. Participant screens have **no app chrome** — full-bleed focused.

---

## 5. Screen Specifications

Each screen: **Desktop layout**, **Mobile layout**, **Components**, **States**, **Sample content**, **Accessibility**.

---

### 5.1 Admin Login (`/admin/login`)

**Layout (all sizes):** centered card on aurora-mesh background. Brand mark + product name, headline ("Administer live feedback sessions"), password field (show/hide toggle), primary "Log in" button, error message area.

**States:** idle; submitting (button spinner, disabled); error (inline danger text, input error ring, shake-free).

**Sample:** placeholder "Password"; error "Invalid credentials".

**A11y:** password field labeled; autofocus; Enter submits; error announced via `aria-live`.

---

### 5.2 Presentation Library (`/admin/presentations`)

**Desktop:** page title + "Upload presentation" primary button top-right. Grid of presentation cards (2–3 columns). Each card: title, slide count, created date, configured-slides indicator, latest session status badge, actions (Configure, Start new session).

**Mobile:** single-column cards; upload is a prominent full-width button at top.

**States:**
- **Empty (no presentations / P1 endpoint pending):** friendly empty state — "Upload your first presentation to get started." CTA opens upload.
- **Loading:** skeleton card grid.
- **Loaded:** cards.
- **Upload modal:** dropzone, title input, slide-count input, file chip, validation, progress bar, success → navigate to configure.

**Upload modal states:** idle, drag-over, file-selected, validating, uploading (progress), error (file type/size), success.

**Note:** Until `GET /api/presentations` (P1) exists, show the empty state + upload CTA as the functional baseline — the screen still ships.

---

### 5.3 Slide Configuration Workspace (`/admin/presentations/:id/configure`)

**Desktop (three regions):**
- **Left — Slide Rail:** numbered list of all slides (1..slideCount). Each item: number circle, slide title or "Untitled", status chip (configured / unconfigured / unsaved). Click selects. "Create Session" primary at bottom (enabled when ≥1 slide configured; unconfigured slides never block — see §6).
- **Center — Editor:** selected slide's Title input, Summary textarea, Feedback builder.
- **Right — Participant Preview:** live mock of what participants see for this slide (slide title + summary + the feedback form as configured). Updates as you edit.

**Mobile/tablet:** rail collapses to a horizontal scroll strip or drawer; preview collapses to a tab or collapsible panel below editor.

**Feedback builder:**
- Segmented control: Disabled / Yes-No / Choice / Open Text.
- When enabled: Question input, Options editor (Choice only — add/remove/reorder option chips), Required toggle, Allow resubmission toggle.
- Per-slide Save button with saved/unsaved indicator; navigation-away guard when unsaved.

**States:** loading skeleton; unsaved (warning dot on rail item); saving; saved (success check); validation error (e.g., choice with no options → inline error from `VALIDATION_ERROR`).

**Unconfigured slide UX:** an unconfigured slide shows "No participant content yet" placeholder in preview; rail marks it "unconfigured"; **it never blocks session creation or start**. This matches backend behavior (blank payload, no form).

**Sample content:** Slide 3, Title "Proposed Architecture", Summary "Frontend → Worker API → D1 + Durable Objects.", Choice question "How clear was this?", options Very clear / Clear / Neutral / Confusing, Required on, Resubmission off.

---

### 5.4 Session Lobby / Control Room (`/admin/sessions/:code`)

**Desktop:** two-column. Left: session identity + lifecycle controls. Right: live status (P2 stats) or a placeholder help panel.

**Top:** presentation title, status badge (draft/live/ended).

**Draft state:** prominent session code box with copy button, "Waiting to start" explainer, large primary "Start Presentation" (with confirmation), secondary "Edit configuration" link.

**Live state:** session code box (smaller, with copy), sticky slide navigator — Previous / `Slide 3 of 8` / Next, slide progress bar, current slide mini-preview (title + summary + rule type), danger "End Presentation" (with confirmation), link to Results/Export. Right panel: connected participant count + responses for current slide (P2); until P2, show a calm "Live — participants are viewing slide 3" panel without counts.

**Ended state:** "Session ended" hero, summary (code, title, timestamps), primary "View Results & Export", secondary "Back to presentations".

**Action states:** button busy/spinner; errors shown as toast + inline (e.g., `SESSION_NOT_LIVE`, `SLIDE_OUT_OF_RANGE`).

**Mobile:** single column, sticky bottom bar with Previous/Next while live; code box collapsible.

---

### 5.5 Results & Export (`/admin/sessions/:code/results`)

**Desktop:** title + status + code; toolbar with "Download JSON" primary and "Back to control" secondary; data table: Slide | Name | Email | Question | Type | Response | Submitted (sortable not required).

**Mobile:** table becomes stacked cards grouped by slide.

**States:** loading skeleton; empty ("No feedback collected."); populated; export toast on download.

---

### 5.6 Participant Join (`/join`)

**All sizes (mobile-first):** centered card on aurora mesh. Headline ("Join the session"), Name, Email, Session Code (uppercase, letter-spaced, 6-char) inputs, primary "Join" button. Pre-fills code from `?code=` query.

**States:** idle; submitting; validation errors (empty name, invalid email via `VALIDATION_ERROR`); server error (`NOT_FOUND`, `SESSION_ENDED` — show "This session isn't accepting joins right now").

**A11y:** all fields labeled; code input `maxLength=6`; Enter submits.

---

### 5.7 Participant Live Experience (`/session/:code`)

The core mobile-first screen. Full-bleed, no app chrome.

**Layout:** top status row (connection badge + slide indicator), slide content card, feedback card, sticky bottom action (when applicable).

**States:**

1. **Waiting (draft / NO_ACTIVE_SLIDE):** calm centered state — "The session will begin soon." connection badge.
2. **Active (SLIDE_CHANGED with content + enabled rule):** slide title + summary card; feedback card with the correct input (Yes/No choice cards, multiple-choice cards, or open textarea) and primary Submit.
3. **Blank slide (SLIDE_CHANGED, null content, disabled rule):** "Nothing to respond to on this slide." No form. Connection stays.
4. **Submitted:** success state — "Thanks! Your response was recorded." If resubmission allowed: "You can update your response" with the form still usable (prefilled). If resubmission disabled: form replaced by locked confirmation.
5. **Reconnecting:** top warning banner "Reconnecting…" + last-known content dimmed; auto-restores on reconnect.
6. **Ended (SESSION_ENDED):** terminal hero — "This session has ended. Thank you for your feedback." No further input.

**Prior-response hydration:** on load and on each slide change, fetch `feedback/me` to prefill the participant's existing response and set submitted/locked state accordingly. *(Optional P1 bootstrap endpoint removes the race; until then, sequence current-slide + feedback/me.)*

**A11y:** slide content in `aria-live` region; feedback inputs labeled; large touch targets (min 44px); status changes announced.

---

## 6. Critical Behavior Rules (must be reflected in UI)

1. **Unconfigured slides never block.** No `SLIDE_NOT_CONFIGURED` should surface. They render as blank with no form. The admin can create/start/navigate regardless.
2. **Server validation is authoritative.** UI shows friendly messages for codes: `RESUBMISSION_NOT_ALLOWED` ("You can't change your response for this slide"), `RESPONSE_REQUIRED`, `INVALID_BOOLEAN`, `INVALID_CHOICE`, `RESPONSE_TOO_LONG`, `FEEDBACK_DISABLED`, `NOT_CURRENT_SLIDE` (silently refresh to current), `SESSION_ENDED`, `SESSION_NOT_LIVE`, `PARTICIPANT_NOT_FOUND`.
3. **`feedbackType` vs `type`:** REST configuration bodies use `feedbackType`; WebSocket/`current-slide` event rules use `type`. UI consumes both correctly — do not "normalize" one side.
4. **Participant identity** persists in `localStorage` (key `participant`). Direct nav to `/session/:code` without a valid stored participant redirects to `/join?code=…`.
5. **WebSocket is server→client only.** No client→server messages.
6. **Copy-to-clipboard, confirmations, skeletons, empty states, toasts** are all frontend-only (P0) — no backend needed.

---

## 7. State & Data Model (frontend)

| Concern | Source | Behavior |
|---------|--------|----------|
| Admin auth | cookie (`credentials: include`) | `adminMe()` guards AdminShell; redirect to login on 401 |
| Session status | `GET /api/sessions/:code` | drives draft/live/ended UI |
| Current slide event | WS `SLIDE_CHANGED` / `GET current-slide` | WS overrides initial; both shapes identical |
| Participant answers | `GET feedback/me` + WS | prefill + submitted/locked state |
| Connection | WS onopen/onclose | badge + reconnect banner |
| Terminal | WS `SESSION_ENDED` | hero, no input |
| Unconfigured slide | blank payload | "nothing to respond to" |

---

## 8. Accessibility & Responsive Summary

- **Keyboard:** all actions reachable; visible focus rings; logical tab order; Esc closes modals/drawers.
- **Screen readers:** `aria-live` for slide changes, submission, connection; labels on all inputs; status badges have accessible names.
- **Touch:** min 44px targets; choice cards full-width on mobile.
- **Responsive:** mobile-first; admin uses drawers/tabs on narrow widths; participant optimized for phone.
- **Reduced motion:** disable pulses/shimmers/slides.
- **Color:** never color-only signaling (badge dot + text).

---

## 9. Stitch Generation Workflow

Generate in phases, not one giant prompt. Each phase produces reusable artifacts and screen variants.

### Phase 1 — Design System & Shell
**Prompt brief:** "Generate a light-first design system named 'Luminous Slate'. Tokens: warm white bg `#F7F8FC`, white surfaces, deep slate text `#1A1D2E`, indigo primary `#5B5BF6`, violet secondary `#8B5CF6`, success `#16A34A`, warning `#D97706`, danger `#DC2626`. Build buttons (primary/secondary/ghost/destructive, sizes sm/md/lg, all states incl. loading), inputs/textarea/select with error states, toggle switch, radio choice cards, segmented control, file dropzone, status badges (draft/live/ended + pulse dot), connection badge, toasts, skeletons, empty states, session code box, stat tile, modal, drawer, admin shell nav. Use 4px spacing scale, 8–16px radii, soft shadows, Inter font. Reduced-motion variants. Produce a component library preview page."

### Phase 2 — Participant Mobile Screens
**Prompt brief:** "Using the Luminous Slate system, generate mobile-first participant screens for a live feedback app: (1) Join card — name/email/6-char code on aurora mesh, validation + server errors; (2) Waiting — 'session begins soon', connection badge; (3) Active slide — title+summary card, Yes/No choice cards, multiple-choice cards, open textarea, large Submit; (4) Submitted — success confirmation, editable if resubmission allowed else locked; (5) Reconnecting banner + dimmed content; (6) Ended hero. Full-bleed, no app chrome, 44px targets, aria-live slide region. Sample: slide 'Proposed Architecture', question 'How clear was this?'. Provide each screen with idle/active/error states."

### Phase 3 — Admin Library & Upload
**Prompt brief:** "Generate admin presentation library: page title + 'Upload' button, responsive card grid (title, slide count, configured indicator, latest session badge, Configure/Start actions), empty state, loading skeletons. Upload modal: dropzone, title, slide count, file chip, progress, validation errors. Desktop multi-column, mobile single-column."

### Phase 4 — Slide Configuration Workspace
**Prompt brief:** "Generate a slide configuration workspace (desktop 3-region): left slide rail (numbered, status chips configured/unconfigured/unsaved), center editor (title, summary, feedback builder with segmented control Disabled/Yes-No/Choice/Text, question, options chips, required + resubmission toggles, save + saved/unsaved indicator), right participant preview mirroring edits. Mobile: rail as horizontal strip + preview as collapsible. Show an unconfigured slide as 'No participant content' (non-blocking). Sample slide 3 architecture content."

### Phase 5 — Session Lobby / Control Room
**Prompt brief:** "Generate session control room: title + status badge (draft/live/ended). Draft: large session code box with copy + Start button. Live: smaller code+copy, sticky Previous/Next, 'Slide 3 of 8' progress, current slide mini-preview, End button with confirm, link to results, right panel placeholder for participant/response counts. Ended: hero + summary + View Results. Action-busy + error toast states. Desktop two-column, mobile single with sticky bottom nav."

### Phase 6 — Results & Export
**Prompt brief:** "Generate results screen: title/status/code, Download JSON + Back buttons, data table (Slide/Name/Email/Question/Type/Response/Submitted) that collapses to stacked cards on mobile, empty state, loading skeleton."

### Phase 7 — Responsive & State Variants
**Prompt brief:** "Produce responsive breakpoints (640/768/1024/1280) for all screens, plus all state variants: loading, empty, error, offline, reduced-motion. Ensure focus states and aria-live regions."

### Review Rubric (per phase)
- Visual hierarchy & task clarity
- Consistency with system tokens & prior screens
- Mobile usability & touch targets
- Accessibility (labels, focus, aria-live, contrast)
- Responsiveness across breakpoints
- State completeness (loading/empty/error/terminal)
- Contract compatibility (uses existing data shapes; `feedbackType` vs `type` respected)

### Iteration & Handoff
- Iterate screens in Stitch until rubric passes.
- Export final Stitch markup/styles.
- Integration (later, separate task): drop generated presentational output into `frontend/src/components/` and `frontend/src/pages/`, wiring to existing `api.ts`, `types.ts`, `usePresentationSocket.ts`. **Do not** let generated code re-implement data fetching or WebSocket logic.

---

## 10. Integration Boundaries (preserve)

- `frontend/src/api.ts` — all REST calls (cookie auth, multipart upload, JSON errors as `ApiError`).
- `frontend/src/types.ts` — contracts.
- `frontend/src/usePresentationSocket.ts` — real-time hook.
- `frontend/src/components/SlideView.tsx`, `FeedbackForm.tsx`, `AdminShell.tsx` — replaceable slots.
- `frontend/src/App.tsx` — routing (unchanged unless new routes added).

**No secrets/keys** appear in any UI or document.

---

## 11. Verification (post-integration)

- `pnpm --filter frontend typecheck`
- `pnpm --filter frontend build`
- Responsive browser review (mobile/tablet/desktop) for every screen.
- Keyboard + screen-reader spot check.
- Multi-tab WebSocket flow: admin changes slide → 2 participant tabs update; end → terminal state; refresh → state restored.
- Unconfigured slide → blank, non-blocking through full flow.
- Download JSON export from results.
