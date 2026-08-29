-- Phase 7 — PPT upload pipeline.
-- Tracks every uploaded file so we can re-upload without breaking existing
-- sessions that reference the old slide IDs. The active file per event is
-- the most recently uploaded one.
--
-- NOTE: per architecture §9 we skip actual PPTX image rendering in Phase 1.
-- The admin authors the slide summary manually (as today); the file just
-- gets uploaded to R2 so it can be downloaded later.

CREATE TABLE presentation_files (
    id            TEXT PRIMARY KEY,
    event_id      TEXT NOT NULL,                       -- events table lands in Phase 2; we soft-FK for now
    r2_key        TEXT NOT NULL,
    original_name TEXT,
    status        TEXT NOT NULL DEFAULT 'processing',  -- processing | ready | failed
    slide_count   INTEGER,
    uploaded_by   TEXT NOT NULL,                       -- users.id lands in Phase 1; we use the synthetic local-admin id
    uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
    error_message TEXT
);
CREATE INDEX idx_presentation_files_event ON presentation_files(event_id);
CREATE INDEX idx_presentation_files_uploaded_at ON presentation_files(uploaded_at);