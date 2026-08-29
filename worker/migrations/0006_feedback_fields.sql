-- Phase 3 — Form builder schema.
-- Replaces the single `feedback_rules` per slide with an ordered set of
-- `feedback_fields` per slide, allowing multiple questions per slide and
-- richer field types (rating, nps, multi_select, textarea).

CREATE TABLE feedback_fields (
    id            TEXT PRIMARY KEY,
    slide_id      TEXT NOT NULL REFERENCES slides(id),
    order_index   INTEGER NOT NULL,
    field_type    TEXT NOT NULL,        -- boolean | single_select | multi_select | rating | nps | text | textarea
    label         TEXT NOT NULL,
    options_json  TEXT,                 -- JSON array for select/rating/nps types
    is_required   INTEGER NOT NULL DEFAULT 0,
    config_json   TEXT                  -- free-form: min/max for rating, allow_resubmission, placeholder, etc.
);
CREATE INDEX idx_fields_slide ON feedback_fields(slide_id, order_index);

-- Migrate the existing single feedback_rule per slide into a single
-- feedback_field row so legacy data is preserved (POC has empty DBs in dev
-- but the migration is safe on populated production data).
INSERT INTO feedback_fields (id, slide_id, order_index, field_type, label, options_json, is_required, config_json)
SELECT fr.id, fr.slide_id, 0,
       CASE fr.feedback_type
         WHEN 'boolean' THEN 'boolean'
         WHEN 'multiple_choice' THEN 'single_select'
         WHEN 'open_text' THEN 'text'
         ELSE 'text'
       END,
       COALESCE(fr.question, 'Your feedback'),
       fr.options_json,
       fr.required,
       json_object('allowResubmission', fr.allow_resubmission)
FROM feedback_rules fr;

DROP TABLE feedback_rules;

-- Phase 3 — sessions.current_slide_id is now an FK to slides (replaces the
-- presentation_sessions.current_slide_number integer).
-- Already nullable; we just confirm the column type.
-- (No-op if it already exists as TEXT.)
