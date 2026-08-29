-- Live Presentation Feedback System — initial schema

CREATE TABLE presentations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    r2_object_key TEXT,
    slide_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE slides (
    id TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL,
    slide_number INTEGER NOT NULL,
    title TEXT,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY (presentation_id) REFERENCES presentations(id),
    UNIQUE(presentation_id, slide_number)
);
CREATE INDEX idx_slides_presentation ON slides(presentation_id);

CREATE TABLE feedback_rules (
    id TEXT PRIMARY KEY,
    slide_id TEXT NOT NULL UNIQUE,

    enabled INTEGER NOT NULL DEFAULT 0,
    required INTEGER NOT NULL DEFAULT 0,
    feedback_type TEXT NOT NULL,
    question TEXT,
    options_json TEXT,
    allow_resubmission INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (slide_id) REFERENCES slides(id)
);

CREATE TABLE presentation_sessions (
    id TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL,
    session_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    current_slide_number INTEGER,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,

    FOREIGN KEY (presentation_id) REFERENCES presentations(id)
);
CREATE INDEX idx_sessions_presentation ON presentation_sessions(presentation_id);

CREATE TABLE participants (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    joined_at TEXT NOT NULL,

    FOREIGN KEY (session_id) REFERENCES presentation_sessions(id),
    UNIQUE(session_id, email)
);
CREATE INDEX idx_participants_session ON participants(session_id);

CREATE TABLE feedback_responses (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    slide_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL,
    question TEXT,
    response_value TEXT,
    submitted_at TEXT NOT NULL,

    FOREIGN KEY (session_id) REFERENCES presentation_sessions(id),
    FOREIGN KEY (participant_id) REFERENCES participants(id),
    FOREIGN KEY (slide_id) REFERENCES slides(id),
    UNIQUE(participant_id, slide_id)
);
CREATE INDEX idx_responses_session ON feedback_responses(session_id);
CREATE INDEX idx_responses_slide ON feedback_responses(slide_id);
