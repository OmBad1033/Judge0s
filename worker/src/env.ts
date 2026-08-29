export interface Env {
  DB: D1Database;
  PRESENTATION_BUCKET: R2Bucket;
  PRESENTATION_SESSION: DurableObjectNamespace;
  ASSETS: Fetcher;

  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;

  CF_ACCESS_TEAM_DOMAIN?: string;
  ENVIRONMENT: string;
}
