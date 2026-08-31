-- PDF ingestion — store the extracted per-page JSON object key alongside the
-- uploaded PDF so the later AI-configure phase can read the raw text.
-- Existing rows get NULL (they predate PDF support).

ALTER TABLE presentation_files ADD COLUMN extracted_json_key TEXT;
