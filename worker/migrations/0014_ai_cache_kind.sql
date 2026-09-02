-- AI Slide Config — Phase 2. Widen the analytics cache so it can store
-- per-event slide-suggestion results as well as per-field text insights.
--   kind IN ('text_insight' | 'slide_suggestion')
-- Existing rows are backfilled as 'text_insight' (the only kind before this
-- migration). The PK stays field_id; slide-suggestion rows key on
-- 'evt:<event_id>'.

ALTER TABLE text_analysis_cache ADD COLUMN kind TEXT NOT NULL DEFAULT 'text_insight';

-- The old UNIQUE was on field_id (still the PK), so no index change needed.
CREATE INDEX idx_cache_kind ON text_analysis_cache(kind, updated_at);
