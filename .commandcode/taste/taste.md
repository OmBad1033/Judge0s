# Taste

## Design system — Judge OS (terminal aesthetic)
- Prefers the **Judge OS** design system: white canvas, 1px dot-grid backdrop, hairline borders, emerald (#10b981) primary, monospace branding.
- Typography: Inter for body/UI labels, **JetBrains Mono for all terminal labels** — brand mark, version tags, section headers, button text, table data, session codes, status pills.
- Sharp 0px corners everywhere (no `rounded-*`).
- Decorations: bracket-style labels `[LIVE_EXECUTOR]`, `[SESSION_ACTIVE]`, `v2.0.4` version tags, terminal `>` prompts, dot-grid pattern, blinking cursor dots, pulsing emerald status dots.
- Top nav uses mono brand mark + ALL-CAPS tab labels with mono-typography and emerald underline-active state.
- Status pills: `[DRAFT]` / `[LIVE]` / `[ENDED]` with color-coded variants.
- KPI scorecards with large mono numbers + small units + colored progress bars.
- Confidence: 0.85

## Workflow
- Prefers **plan mode** for large multi-file rebuilds (UI overhauls, backend schema changes, monorepo-wide edits) — wants a written plan before code is touched.
- Prefers to **preserve existing backend** when rebuilding frontend — drive the new UI with the existing API client, mock only fields the backend doesn't have.
- Prefers **mock data declared as pure deterministic helpers** (deterministic hash for fake rosters, metrics derived from real backend fields) so re-renders don't shuffle rows.
- Wants **Stitch MCP screen IDs referenced explicitly** in plans (e.g. `projects/.../screens/<id>`) so each page maps 1:1 to a specific design.
- Wants every plan to enumerate "real vs mock" data per page — no ambiguity about which data is from the backend.
- Prefers **verification steps** in plans: typecheck + build + dev smoke test + an end-to-end walkthrough (login → upload → configure → session → join → submit → export).
- Confidence: 0.85

## Tooling & repo conventions
- Uses **pnpm** in a monorepo with `--filter frontend` / `--filter worker` for typecheck/build.
- Cloudflare Worker backend + React frontend (Vite) is the standard stack.
- Project lives at `/Users/t0240vg/Documents/<name>` — names like `Feedback_X`.
- Admin password lives in `worker/.dev.vars` as `ADMIN_PASSWORD`.
- Backend routes: Hono + D1, mounted at `/api/*`.
- Frontend routes: React Router (`/`, `/admin/login`, `/admin/presentations`, `/admin/presentations/:id/configure`, `/admin/sessions/:code`, `/admin/sessions/:code/results`, `/join`, `/session/:code`).
- Participation flow is **two distinct pages**: `/join` (entry form) and `/session/:code` (in-session question view).
- Confidence: 0.9

## Documentation convention
- Maintains separate **architecture / plan markdown files at the repo root**: `architecture.md` (LLD: schema, API surface, DO design, auth, pipeline), `backend_plan.md` (phased backend build plan + parallelization), `frontend_plan.md` (mobile-first frontend plan, persona-based device priority, page inventory, phasing F0–F9). Distinct from `plan.md` (high-level phased rollout) and `README.md` (intro).
- These root-level docs describe the **target** design — they may be forward-looking relative to the current code, and the schema/impl should be treated as source of truth until a doc'd phase lands. The doc files are not auto-synced with code.
- Confidence: 0.7