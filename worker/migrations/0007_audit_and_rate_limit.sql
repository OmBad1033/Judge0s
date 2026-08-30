-- Phase 8 — Hardening: audit log + rate limit buckets.

CREATE TABLE audit_log (
    id            TEXT PRIMARY KEY,
    actor_id      TEXT,
    actor_kind    TEXT,                  -- 'user' | 'admin_cookie' | 'anonymous'
    action        TEXT NOT NULL,
    target        TEXT,
    metadata_json TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at);

CREATE TABLE rate_limit_buckets (
    key          TEXT PRIMARY KEY,
    count        INTEGER NOT NULL DEFAULT 1,
    window_start TEXT NOT NULL,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rate_limit_updated ON rate_limit_buckets(updated_at);