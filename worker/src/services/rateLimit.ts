import type { Env } from '../env';

const WINDOW_MS = 60 * 1000; // 1 minute fixed window

export interface RateLimitConfig {
  /** Unique key for this bucket (e.g. `join:session-code:1.2.3.4`). */
  key: string;
  /** Max requests per window. */
  limit: number;
  /** Window length in ms. Defaults to 60s. */
  windowMs?: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * Phase 8 — fixed-window rate limiter backed by D1.
 * Atomic-enough for our use case: a single UPSERT bumps the counter if the
 * window is the same, otherwise resets. Race conditions may let a few
 * extra requests through, but the cap is enforced on average.
 */
export async function rateLimit(env: Env, cfg: RateLimitConfig): Promise<RateLimitResult> {
  const windowMs = cfg.windowMs ?? WINDOW_MS;
  const now = Date.now();
  const windowStart = new Date(now - (now % windowMs)).toISOString();
  const updatedAt = new Date(now).toISOString();

  // UPSERT: if the row exists for this key and the window is the same, increment;
  // otherwise reset count to 1 and set a new window_start.
  await env.DB.prepare(
    `INSERT INTO rate_limit_buckets (key, count, window_start, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limit_buckets.window_start = excluded.window_start
                    THEN rate_limit_buckets.count + 1
                    ELSE 1
               END,
       window_start = excluded.window_start,
       updated_at = excluded.updated_at`,
  )
    .bind(cfg.key, windowStart, updatedAt)
    .run();

  const row = await env.DB.prepare(
    'SELECT count, window_start FROM rate_limit_buckets WHERE key = ?',
  )
    .bind(cfg.key)
    .first<{ count: number; window_start: string }>();

  const count = row?.count ?? 1;
  const winStartMs = row ? new Date(row.window_start).getTime() : now;
  const resetMs = winStartMs + windowMs - now;
  const remaining = Math.max(0, cfg.limit - count);
  return { ok: count <= cfg.limit, remaining, resetMs };
}

export function rateLimitHeaders(result: RateLimitResult, limit: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetMs / 1000)),
  };
}