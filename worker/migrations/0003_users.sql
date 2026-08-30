-- Phase 1 — Auth overhaul: users (Google OAuth) and per-event admins.
-- The legacy password/cookie admin path keeps working on top of these tables
-- via the synthetic 'admin' user upserted on first password login.

CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    google_sub    TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT,
    avatar_url    TEXT,
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
);

CREATE TABLE event_admins (
    event_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL REFERENCES users(id),
    role          TEXT NOT NULL DEFAULT 'admin',
    invited_by    TEXT REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_event_admins_user ON event_admins(user_id);

-- Synthetic super-admin for the legacy password-login path.
-- Real Google users will be upserted with their own id; this row exists
-- so that legacy admin actions have an `owner_id` to point at.
INSERT INTO users (id, google_sub, email, name, is_super_admin)
VALUES ('local-admin', 'local|admin', 'admin@local', 'Local Admin', 1)
ON CONFLICT(id) DO NOTHING;