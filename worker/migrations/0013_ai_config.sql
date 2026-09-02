-- AI Slide Config Feature — Phase 1: AI schema + gating (no AI logic yet).
-- Storage for slide/field suggestions, generation jobs, and chat turns. The
-- gate middleware and route stubs ship before any LLM call exists so Phase 2+
-- never ships without protection.

ALTER TABLE events ADD COLUMN ai_context TEXT;

CREATE TABLE ai_slide_suggestions (
    slide_id          TEXT PRIMARY KEY REFERENCES slides(id),
    suggested_title   TEXT,
    suggested_summary TEXT,
    status            TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    created_at        TEXT
);
CREATE INDEX idx_ai_slide_sugg_status ON ai_slide_suggestions(status);

CREATE TABLE ai_field_suggestions (
    id           TEXT PRIMARY KEY,
    slide_id     TEXT REFERENCES slides(id),
    order_index  INTEGER,
    field_type   TEXT,
    label        TEXT,
    options_json TEXT,
    is_required  INTEGER,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT
);
CREATE INDEX idx_ai_field_sugg_slide ON ai_field_suggestions(slide_id);
CREATE INDEX idx_ai_field_sugg_status ON ai_field_suggestions(status);

CREATE TABLE ai_generation_jobs (
    id                   TEXT PRIMARY KEY,
    event_id             TEXT REFERENCES events(id),
    presentation_file_id TEXT REFERENCES presentation_files(id),
    status               TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed
    error                TEXT,
    created_at           TEXT,
    completed_at         TEXT
);
CREATE INDEX idx_ai_jobs_event ON ai_generation_jobs(event_id);

CREATE TABLE ai_chat_messages (
    id                     TEXT PRIMARY KEY,
    event_id               TEXT REFERENCES events(id),
    role                   TEXT,             -- user | assistant
    content                TEXT,
    proposed_changes_json  TEXT,
    applied                INTEGER DEFAULT 0,
    created_at             TEXT
);
CREATE INDEX idx_ai_chat_event ON ai_chat_messages(event_id, created_at);
