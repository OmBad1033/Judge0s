# Backend Coordination Notes (running log)

> Read this at the start of every session before touching `api.ts` or page components.

## TL;DR for the frontend agent

The backend agent has landed the **big rebuild** per `architecture.md` and `backend_plan.md`. Every legacy API surface (`/api/presentations/*`, `/api/sessions/*`, `/api/admin/*`) is still alive and returns the same JSON shapes your existing `frontend/src/api.ts` expects. New endpoints are added alongside — you can opt in whenever you're ready.

**You do not need to do anything yet.** Your `api.ts` and pages continue to work. When you want to migrate, the table below is the pick-list.

## New endpoints you can use right now (all additive)

| New endpoint | Replaces / complements | Notes |
|---|---|---|
| `GET /api/auth/me` | `GET /api/admin/me` | Returns the full user object. Works with the legacy `admin_token` cookie (compat shim) or a new Google `user_token` JWT. |
| `POST /api/auth/google/start` | — | 302 to Google OAuth. Configure `GOOGLE_CLIENT_ID` / `GOOGLE_REDIRECT_URI` in `worker/.dev.vars`. |
| `GET /api/auth/google/callback` | — | Exchanges the OAuth code, upserts the user, sets the `user_token` cookie, redirects to `/admin/presentations`. |
| `POST /api/auth/logout` | `POST /api/admin/logout` | Clears the `user_token` cookie. |
| `POST /api/events` | `POST /api/presentations` | Creates an event. Returns `{ id, name, description, ownerId, status, createdAt, updatedAt }`. |
| `GET /api/events` | `GET /api/presentations` | Lists events the user can admin (or all, for super admin). |
| `GET /api/events/:id` | `GET /api/presentations/:id` | Event detail. |
| `PATCH /api/events/:id` | — | Rename / describe / archive. |
| `DELETE /api/events/:id` | — | Owner or super admin. |
| `GET /api/events/:id/sessions` | `GET /api/sessions?presentationId=…` | Sessions for an event. |
| `POST /api/events/:id/sessions` | `POST /api/sessions` | Create a session. Body: `{}`. Returns the same `Session` shape. |
| `POST /api/events/:id/presentation` | `POST /api/presentations` | Multipart upload. |
| `GET /api/events/:id/presentation` | — | Status: `processing | ready | failed`. |
| `PUT /api/events/:id/slides/:slideId/fields` | `PUT /api/presentations/:id/slides/:n` | New form-builder. Body: `[{ fieldType, label, options?, isRequired?, config? }, …]`. |
| `GET /api/events/:id/slides/:slideId/fields` | — | List a slide's field set. |
| `POST /api/auth/events/:id/admins` | — | Invite a co-admin by email. |
| `GET /api/auth/events/:id/admins` | — | List co-admins. |
| `DELETE /api/auth/events/:id/admins/:userId` | — | Remove a co-admin. |
| `GET /api/events/:id/export` | `GET /api/sessions/:code/export` | Per-event rollup (JSON). |
| `GET /api/events/:id/export.csv` | — | Per-event rollup (CSV). |
| `GET /api/sessions/:code/state` | `GET /api/sessions/:code/participant-state` | Mobile-reconnect fallback. Same shape; cheaper. |

## Wire-shape notes (additive fields, no breakage)

- `POST /api/sessions/:code/join` now returns an extra `joinToken` field. You can ignore it; the existing `participantId` keeps working.
- `POST /api/presentations` (and the new `/api/events/:id/presentation`) now returns a few extra fields: `status` ("ready"), `presentationFileId`, `uploadedBy`. The existing fields are unchanged.
- `GET /api/sessions/:code/control-state` is unchanged.

## Breaking changes (none today)

None of the new work breaks your existing API calls. The only file in `worker/src/durable-objects/` that was renamed (`PresentationSession` → `SessionRoom`) is internal — the WS URL `/ws/session/:code` and the message shapes are unchanged.

## What's pending on the backend side

Nothing — all 8 phases from `backend_plan.md` are landed. If you want to push more, the doc has a "What I will NOT do" section listing items deliberately deferred (actual PPTX image rendering, super-admin UI, etc.).

## Environment for local dev

If you're spinning up the backend fresh:

```bash
cd worker
cp .dev.vars.example .dev.vars   # add ADMIN_PASSWORD, SESSION_SECRET, JWT_SECRET
pnpm install
pnpm db:migrate:local
cd ../frontend && pnpm install && pnpm build
cd ../worker && pnpm dev
```

The `.dev.vars.example` already has placeholders for everything. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` can be left blank to disable the OAuth routes (everything still works via the password fallback).

## How to reach the backend agent

There's a single coordination file at `~/.commandcode/plans/backend-rebuild.md` that contains the full plan + risk register + verification log. The frontend agent should skim it at the start of every session. If something on the backend doesn't match what you expect, the load-bearing promise is: **the legacy API surface is invariant** — your existing `api.ts` calls keep working without changes.