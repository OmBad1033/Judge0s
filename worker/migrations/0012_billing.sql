-- AI Slide Config Feature — Phase 0: billing foundation.
-- Adds plan state to `users` (gated on the Event owner's plan per ai_plan.md),
-- a free-trial allowance so new users get AI access on one presentation, and
-- an idempotent log of incoming Stripe webhook events.

ALTER TABLE users ADD COLUMN plan_status TEXT NOT NULL DEFAULT 'free';
-- plan_status: free | active | past_due | canceled

ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN plan_updated_at TEXT;

-- Free trial: a brand-new user starts with one presentation's worth of AI
-- access (all co-admins benefit — the allowance is keyed to the event owner).
-- trial_presentation_used_at is set the first time the owner's event consumes
-- the free trial via an AI request, which flips the allowance to "used".
ALTER TABLE users ADD COLUMN trial_presentation_used_at TEXT;

CREATE TABLE billing_events (
    id             TEXT PRIMARY KEY,
    user_id        TEXT REFERENCES users(id),
    stripe_event_id TEXT UNIQUE,   -- idempotency: Stripe retries webhooks
    type           TEXT,
    raw_json       TEXT,
    processed_at   TEXT
);
CREATE INDEX idx_billing_events_stripe ON billing_events(stripe_event_id);
