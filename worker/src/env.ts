export interface Env {
  DB: D1Database;
  PRESENTATION_BUCKET: R2Bucket;
  PRESENTATION_SESSION: DurableObjectNamespace;
  ASSETS: Fetcher;

  // Legacy password admin path (Phase 0). Still supported for local dev.
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;

  // Phase 1 — Google OAuth + user JWTs.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  SUPER_ADMIN_EMAILS?: string;
  JWT_SECRET: string;

  CF_ACCESS_TEAM_DOMAIN?: string;
  ENVIRONMENT: string;

  // Phase 8 — CORS lockdown.
  ORIGIN_ALLOWLIST?: string;
}