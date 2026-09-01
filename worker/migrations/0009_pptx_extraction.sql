-- PPTX extraction — store the R2 object key of the Markdown rendering of the
-- structured slide content, alongside the extracted JSON. Existing rows get
-- NULL (they predate structured PPTX extraction).

ALTER TABLE presentation_files ADD COLUMN extracted_md_key TEXT;
