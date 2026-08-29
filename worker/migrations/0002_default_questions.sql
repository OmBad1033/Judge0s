-- Default questions: generic questions the admin applies to all/selected slides
-- (e.g. "Interested / Not interested", "Rate 0-10"). Shown to participants on
-- each targeted slide, in addition to the slide's own feedback rule.

CREATE TABLE default_questions (
    id TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL,        -- 'interested' | 'rating'
    target_slides TEXT NOT NULL DEFAULT '[]',  -- JSON array of slide numbers, e.g. '[1,2,3]'
    created_at TEXT NOT NULL,

    FOREIGN KEY (presentation_id) REFERENCES presentations(id)
);
CREATE INDEX idx_default_questions_presentation ON default_questions(presentation_id);

CREATE TABLE default_responses (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    default_question_id TEXT NOT NULL,
    slide_number INTEGER NOT NULL,
    response_value TEXT NOT NULL,
    submitted_at TEXT NOT NULL,

    FOREIGN KEY (session_id) REFERENCES presentation_sessions(id),
    FOREIGN KEY (participant_id) REFERENCES participants(id),
    FOREIGN KEY (default_question_id) REFERENCES default_questions(id),
    UNIQUE(participant_id, default_question_id, slide_number)
);
CREATE INDEX idx_default_responses_session ON default_responses(session_id);
