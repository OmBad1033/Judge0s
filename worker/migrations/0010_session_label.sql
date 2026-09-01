-- Session names: `sessions.label` already exists (added in 0005) but was never
-- populated. Give the legacy compat table the same column so mirrored rows keep
-- the label. Existing rows get NULL (they predate session names).

ALTER TABLE presentation_sessions ADD COLUMN label TEXT;
