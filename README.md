# Live Presentation Feedback System — Cloudflare POC

A real-time presentation feedback POC built entirely on Cloudflare. An admin
controls a live presentation; every connected participant instantly sees the
current slide and its feedback form; responses are validated server-side and
exportable as structured JSON.

## Core principle

- **D1** stores what happened (presentations, slides, rules, sessions, participants, responses).
- **R2** stores the uploaded `.pptx` artifact.
- **Durable Objects** coordinate what is happening right now (WebSocket fan-out).
- **Workers** run the REST API + business logic.
- **React** provides the admin and participant interfaces.

## Stack

- Worker: Hono + Zod on Cloudflare Workers (TypeScript), with D1, R2, and a Durable Object.
- Frontend: React + Vite, served as Worker Static Assets (single deploy unit).
- Monorepo: pnpm workspaces (`worker/`, `frontend/`).

## Local development

The whole POC runs locally with no Cloudflare account required (Miniflare).

```bash
pnpm install
pnpm --filter worker db:migrate:local   # apply D1 schema locally
pnpm dev                                  # runs worker + frontend (two terminals, or use the two below)
# or separately:
pnpm dev:worker     # wrangler dev on :8787
pnpm dev:frontend   # vite dev on :5173 (proxies /api and /ws to :8787)
```

Worker secrets for local dev live in `worker/.dev.vars` (gitignored). Copy
`worker/.dev.vars.example` → `.dev.vars` and set an admin password + session
secret.

- `ADMIN_PASSWORD` — admin login password (local dev).
- `SESSION_SECRET` — HMAC key for the signed admin session cookie.
- `ENVIRONMENT` — `local` or `production`.

## Admin authentication

Production uses **Cloudflare Access** in front of `/admin/*` and the admin API
routes. The admin guard trusts the `Cf-Access-Jwt-Assertion` header when
present (TODO: verify signature via Access JWKS once `CF_ACCESS_TEAM_DOMAIN` is
configured at deploy time). In local dev (no Access proxy) it falls back to the
password login → signed cookie path above.

## API surface

```
POST   /api/admin/login
GET    /api/admin/me

POST   /api/presentations                     (multipart: title, slideCount, file=.pptx)
GET    /api/presentations/:id

GET    /api/presentations/:id/slides
PUT    /api/presentations/:id/slides/:slideNumber

POST   /api/sessions                          { presentationId }
GET    /api/sessions/:code
POST   /api/sessions/:code/start
PATCH  /api/sessions/:code/slide              { slideNumber }
POST   /api/sessions/:code/end
GET    /api/sessions/:code/current-slide
GET    /api/sessions/:code/export

POST   /api/sessions/:code/join               { name, email } -> participantId
POST   /api/sessions/:code/feedback            { participantId, slideNumber, response }
GET    /api/sessions/:code/feedback/me?participantId=...

POST   /api/billing/checkout                    (Stripe Checkout subscription)
POST   /api/billing/portal                      (Stripe customer portal)
POST   /api/webhooks/stripe                     (Stripe webhook — raw body signature)

POST   /api/events/:id/ai/generate              (AI slide suggestions — paid gate)
GET    /api/events/:id/ai/suggestions           (list pending per-slide suggestions)
POST   /api/events/:id/ai/suggestions/:slideId/approve   (apply + optional edits)
POST   /api/events/:id/ai/suggestions/:slideId/reject    (discard)
POST   /api/events/:id/ai/suggestions/:slideId/revise    (regenerate w/ admin comments)
POST   /api/events/:id/ai/chat                  (conversational config — not yet)
POST   /api/events/:id/ai/chat/apply            (apply chat diff — not yet)

GET    /ws/session/:code                       (WebSocket upgrade)
```

The AI suggestion endpoints are exposed on the configure page: per-slide
proposed title/summary/feedback fields with **Approve / Reject / Suggest
changes** (free-text comment → model revises). Access is gated on the event
owner's plan — free accounts get one presentation of AI access, then a
`402 upgrade_required` paywall.

## Real-time protocol (server → client)

```json
{ "type": "SLIDE_CHANGED", "slideNumber": 4, "slide": { "slideNumber": 4, "title": "...", "summary": "..." }, "feedbackRule": { "enabled": true, "required": true, "type": "multiple_choice", "question": "...", "options": ["..."], "allowResubmission": false } }
{ "type": "SESSION_ENDED" }
```

## Deployment (later)

Replace the placeholder `database_id` in `worker/wrangler.jsonc` with the
output of `wrangler d1 create live-feedback-db`, create the R2 bucket, set
secrets via `wrangler secret put`, then `pnpm --filter worker deploy`. Enable
Cloudflare Access on admin routes.

## Notes / out of scope (per plan)

No QR codes, no server-side PPT rendering (admin provides slide summaries),
no analytics/dashboards, no user accounts. Slide count is entered manually at
upload. Resubmission is enforced per-slide on the backend (upsert when
allowed, reject otherwise).
