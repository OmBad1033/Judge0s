-- Phase 2 — Events + Sessions split.
-- `events` is the persistent container; `sessions` is one live run of it.
-- We keep the legacy `presentation_sessions` table alive for the compat layer
-- and add a FK column on `participants.session_id` to point at the new table.
-- The legacy `session_id` column is preserved; new code reads from `participants.session_id`
-- which we now repoint to the new `sessions` table.
--
-- Strategy: the new `sessions` row is created with the same `id` as the legacy
-- `presentation_sessions` row when the compat layer is used, so the participant
-- rows that already reference it don't need re-keying. New sessions created
-- via `/api/events/:id/sessions` get fresh ids.

CREATE TABLE events (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    owner_id    TEXT NOT NULL REFERENCES users(id),
    status      TEXT NOT NULL DEFAULT 'draft',  -- draft | configured | archived
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_owner ON events(owner_id);

CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL REFERENCES events(id),
    session_code    TEXT NOT NULL UNIQUE,
    label           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending', -- pending | live | paused | ended
    current_slide_id TEXT,                           -- FK added in Phase 3
    created_by      TEXT NOT NULL REFERENCES users(id),
    started_at      TEXT,
    ended_at        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_event ON sessions(event_id);
CREATE INDEX idx_sessions_code ON sessions(session_code);

-- Per-event admin membership (replaces the inline mapping in Phase 1's
-- event_admins table; both work the same for now).
-- (Already created in 0003_users.sql; kept for reference.)

-- Add a join_token column to participants (Phase 5 will mint signed JWTs).
-- We keep the existing UNIQUE(session_id, email) constraint.
ALTER TABLE participants ADD COLUMN join_token TEXT;
CREATE UNIQUE INDEX idx_participants_join_token ON participants(join_token);

-- Backfill: every existing presentation becomes an event (using the
-- presentation id as the event id so legacy presentation_id routes still
-- work via a join view in the compat layer). This is safe in a POC with
-- empty local DBs but a no-op on data that's already migrated.
INSERT OR IGNORE INTO events (id, name, owner_id, status, created_at, updated_at)
SELECT p.id, p.title, 'local-admin', 'configured', p.created_at, p.created_at
FROM presentations p;

-- Backfill: every existing presentation_session becomes a session row using
-- the same id (preserves participant.session_id references). The session_code
-- stays the same. event_id is the presentation_id.
INSERT OR IGNORE INTO sessions (
    id, event_id, session_code, status, current_slide_id,
    created_by, started_at, ended_at, created_at
)
SELECT ps.id, ps.presentation_id, ps.session_code,
       CASE
         WHEN ps.status = 'draft' THEN 'pending'
         WHEN ps.status = 'live'  THEN 'live'
         WHEN ps.status = 'ended' THEN 'ended'
         ELSE 'pending'
       END,
       NULL,
       'local-admin',
       ps.started_at,
       ps.ended_at,
       ps.created_at
FROM presentation_sessions ps;