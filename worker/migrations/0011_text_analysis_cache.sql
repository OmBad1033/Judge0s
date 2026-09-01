-- Analytics — cache for OpenRouter free-text analysis (theme clustering +
-- sentiment). Keyed by feedback_field id so repeated page loads don't re-bill
-- the LLM. `response_hash` invalidates the cache when the response set changes
-- (e.g. after resubmission).

CREATE TABLE IF NOT EXISTS text_analysis_cache (
    field_id      TEXT PRIMARY KEY,
    response_hash TEXT NOT NULL,
    insight_json  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
