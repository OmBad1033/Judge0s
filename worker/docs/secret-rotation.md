# Secret Rotation Runbook

This Worker has four secrets that need to be rotated on a regular cadence (or immediately on suspected compromise).

## 1. `JWT_SECRET` — used to sign user session JWTs

- **What it protects:** every `Authorization: Bearer <jwt>` issued by `/api/auth/google/callback`. Also signs `join_token` for participants (Phase 5).
- **Blast radius on leak:** any attacker can mint themselves an admin JWT for any user-id they choose. Until Cloudflare Access is in front of admin routes, this is full admin.
- **Rotation procedure:**
  1. Generate a new 32-byte random value (`openssl rand -base64 32`).
  2. Run `pnpm wrangler secret put JWT_SECRET` in `worker/`.
  3. Re-deploy: `pnpm --filter worker deploy`.
  4. All existing user sessions are invalidated; users have to log in again.
  5. Notify users (in-app banner or email) that they'll need to re-auth.

## 2. `SESSION_SECRET` — used for the legacy password admin cookie

- **What it protects:** the `admin_token` cookie issued by `POST /api/admin/login`.
- **Blast radius on leak:** the dev fallback admin path is compromised (anyone can mint a valid cookie if they know the password too).
- **Rotation procedure:**
  1. Generate a new value.
  2. `pnpm wrangler secret put SESSION_SECRET` + redeploy.
  3. All active admin cookies are invalidated; admins re-login.

## 3. `GOOGLE_CLIENT_SECRET` — OAuth client secret

- **What it protects:** exchanges Google authorization codes for tokens during the `/api/auth/google/callback` roundtrip.
- **Blast radius on leak:** attacker can complete OAuth flows on behalf of your app (but cannot impersonate Google users without their consent; Google still requires user interaction on its end).
- **Rotation procedure:**
  1. In the Google Cloud Console, create a new OAuth client secret. Mark the old one as "Disabled" but don't delete until step 3.
  2. `pnpm wrangler secret put GOOGLE_CLIENT_SECRET` + redeploy.
  3. After 24h, delete the old secret in Google Cloud Console.

## 4. `ADMIN_PASSWORD` — local dev only

- **What it protects:** the `POST /api/admin/login` fallback when Cloudflare Access is not in front of the admin routes.
- **Blast radius on leak:** anyone hitting the dev path can authenticate as admin. Production should always be behind Cloudflare Access — the dev path is for local testing only.
- **Rotation procedure:** update `worker/.dev.vars` for local dev. For production, this password is unused (Access handles auth); rotate the Google OAuth client instead.

## Rotation cadence (recommended)

| Secret | Cadence | On suspected compromise |
|---|---|---|
| `JWT_SECRET` | 90 days | Immediately |
| `SESSION_SECRET` | 90 days | Immediately |
| `GOOGLE_CLIENT_SECRET` | 180 days | Immediately (and audit Google Cloud audit logs) |
| `ADMIN_PASSWORD` | Per-developer | Immediately |

## Verifying rotation worked

After rotating any secret + redeploying:

```bash
curl -sS https://<worker-host>/api/health
# {"status":"ok","db":true}
```

Then log in (legacy or OAuth depending on what you rotated) and confirm the session works.

## Audit log

Every admin mutation should write to `audit_log` (Phase 8). If you suspect a leak, query:

```sql
SELECT * FROM audit_log WHERE actor_id IS NULL OR actor_kind = 'admin_cookie' ORDER BY created_at DESC LIMIT 100;
```

Anonymous or cookie-only entries are the highest-signal rows to inspect.