export interface Env {
  DB: D1Database;
  PRESENTATION_BUCKET: R2Bucket;
  PRESENTATION_SESSION: DurableObjectNamespace;
  ASSETS?: Fetcher;

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

  // Analytics — OpenRouter LLM (theme clustering + sentiment for free text).
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;

  // AI Slide Config — Phase 0 billing (Stripe). Optional in local dev; the
  // billing routes return a clear "not configured" error when absent.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;

  // When true, gates are bypassed and every AI route acts as a paid plan.
  // Local-dev convenience only; never set in production.
  BILLING_BYPASS?: string;
}