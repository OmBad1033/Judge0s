# Live Presentation Feedback System — Cloudflare POC Build Plan

## 1. Product Goal

Build a small Proof of Concept for a **real-time presentation feedback system**.

The POC flow is:

```text
Admin
  ↓
Upload PPT
  ↓
Configure each slide
  ├─ Slide summary/content shown to users
  ├─ Feedback enabled/disabled
  ├─ Feedback type
  ├─ Required/optional
  └─ Resubmission allowed/not allowed
  ↓
Create live session
  ↓
Get a session code
  ↓
Start presentation
  ↓
Control current slide
  ↓
Users receive the current slide + feedback form in real time
  ↓
Users submit feedback
  ↓
Admin ends presentation
  ↓
Admin exports structured JSON
```

The primary objective is to prove:

> **Admin-controlled presentation state can be synchronized in real time with multiple users, while each slide dynamically controls the feedback experience.**

This is intentionally a POC. Advanced analytics, dashboards, authentication systems, PPT visual rendering, and production-scale features are out of scope.

---

# 2. Important POC Decisions

## 2.1 Cloudflare-first architecture

The entire application should be designed around Cloudflare services rather than building a traditional always-running FastAPI/PostgreSQL/Docker backend.

Recommended Cloudflare stack:

- **Cloudflare Workers** — API/backend
- **Cloudflare Durable Objects** — real-time presentation/session synchronization
- **Cloudflare D1** — relational application data
- **Cloudflare R2** — PPT file/object storage
- **Cloudflare Pages or Workers Static Assets** — frontend hosting
- **Cloudflare WebSockets** — real-time browser communication through Durable Objects
- **Cloudflare Access** or simple POC authentication later if required
- **Cloudflare Wrangler** — local development, deployment, migrations, secrets

The architecture should avoid dependencies that require a persistent VM/server process.

---

## 2.2 No QR code for the POC

Do **not** implement QR code generation.

The admin should only receive a session code.

Example:

```text
Your presentation is ready.

Session Code:
ABX729
```

Users manually enter this code.

This intentionally removes QR-generation and QR-payload complexity from the POC.

---

## 2.3 No server-side PPT slide rendering

For the POC, **do not attempt to render PPT slides to PNG/images on the backend**.

The admin will manually provide a summary for every slide.

Example:

```text
Slide 3

Summary:
"The proposed architecture consists of the frontend,
API layer, database and real-time communication layer."
```

That summary is what is reflected to users.

This removes the need for:

- LibreOffice
- Poppler
- ImageMagick
- PPT rendering containers
- Linux graphics dependencies
- Large Docker images
- Server-side presentation rendering

The uploaded PPT should still be stored in R2 as the original presentation artifact.

The POC's user-facing "slide" is represented by:

- Slide number
- Optional slide title
- Admin-provided summary
- Feedback form

Future versions can introduce actual slide rendering if required.

---

## 2.4 Resubmission is configurable per slide

The admin controls whether users can submit feedback again for a particular slide.

Example:

```text
Slide 1
Feedback: Disabled

Slide 2
Feedback: Yes/No
Required: Yes
Resubmission: No

Slide 3
Feedback: Multiple Choice
Required: No
Resubmission: Yes

Slide 4
Feedback: Open Text
Required: Yes
Resubmission: No
```

The backend must enforce this rule.

It must not rely only on frontend UI restrictions.

If:

```text
allow_resubmission = false
```

and the participant already submitted feedback for that slide, another submission must be rejected.

If:

```text
allow_resubmission = true
```

the new response should replace the previous response for that participant and slide.

For the POC, use an upsert model when resubmission is allowed.

---

# 3. Cloudflare Architecture

```text
                         Internet
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Cloudflare           │
                 │ Pages / Workers      │
                 │ Frontend             │
                 └──────────┬──────────┘
                            │
                 HTTPS REST │ WebSocket
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Cloudflare Worker   │
                 │ API                 │
                 │                     │
                 │ - sessions          │
                 │ - presentations     │
                 │ - feedback          │
                 │ - export            │
                 │ - validation        │
                 └───────┬─────────────┘
                         │
              ┌──────────┴──────────────┐
              │                         │
              ▼                         ▼
      ┌───────────────┐        ┌─────────────────┐
      │ Cloudflare D1 │        │ Cloudflare R2   │
      │               │        │                 │
      │ metadata      │        │ PPT files       │
      │ slides        │        │ future assets   │
      │ rules         │        │                 │
      │ sessions      │        └─────────────────┘
      │ participants  │
      │ feedback      │
      └───────────────┘

                         │
                         │ WebSocket
                         ▼
                ┌──────────────────────┐
                │ Durable Object       │
                │                      │
                │ Presentation Session │
                │                      │
                │ - connected users    │
                │ - live connections   │
                │ - broadcast events   │
                └──────────────────────┘
```

## Why Durable Objects?

The application has a natural concept of a single live room:

```text
Session ABX729
```

All participants connected to `ABX729` need to receive the same real-time presentation events.

A Durable Object can represent that individual presentation session.

Conceptually:

```text
Durable Object
ID = sessionId

        ├── Admin connection
        ├── User connection
        ├── User connection
        └── User connection
```

When the admin changes the slide:

```text
Admin
  ↓
Worker API
  ↓
Persist current slide in D1
  ↓
Notify session Durable Object
  ↓
Broadcast SLIDE_CHANGED
  ↓
All connected users
```

The Durable Object is therefore responsible for **live connection management and fan-out**, while D1 remains the durable application data store.

---

# 4. Source of Truth

Use the following separation:

### D1

Durable source of truth for:

- Presentation metadata
- Slides
- Feedback rules
- Session metadata
- Current slide
- Participants
- Feedback responses

### Durable Object

Responsible for:

- Active WebSocket connections
- Real-time message delivery
- Session-level connection lifecycle

Do not make the live slide state exist only inside Durable Object memory.

The current slide must also be persisted in D1.

This means:

```text
D1:
current_slide = 4
```

If the Worker/DO restarts, the application can reconstruct the session state.

---

# 5. Repository Structure

Recommended project structure:

```text
live-feedback/
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── admin/
│   │   │   └── user/
│   │   ├── components/
│   │   ├── services/
│   │   └── types/
│   ├── package.json
│   └── ...
│
├── worker/
│   ├── src/
│   │   ├── index.ts
│   │   ├── env.ts
│   │   ├── routes/
│   │   │   ├── presentations.ts
│   │   │   ├── sessions.ts
│   │   │   ├── participants.ts
│   │   │   ├── feedback.ts
│   │   │   └── export.ts
│   │   │
│   │   ├── services/
│   │   │   ├── presentationService.ts
│   │   │   ├── sessionService.ts
│   │   │   ├── feedbackService.ts
│   │   │   └── exportService.ts
│   │   │
│   │   ├── durable-objects/
│   │   │   └── PresentationSession.ts
│   │   │
│   │   ├── db/
│   │   │   ├── queries.ts
│   │   │   └── migrations/
│   │   │
│   │   ├── validation/
│   │   │   └── feedback.ts
│   │   │
│   │   └── utils/
│   │       └── sessionCode.ts
│   │
│   ├── wrangler.jsonc
│   ├── package.json
│   └── tsconfig.json
│
├── README.md
└── plan.md
```

Use TypeScript for the Worker/backend because it integrates naturally with the Cloudflare Workers runtime and APIs.

---

# 6. Database Design — Cloudflare D1

D1 is SQLite-based, so design the schema accordingly.

## 6.1 presentations

```sql
CREATE TABLE presentations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    r2_object_key TEXT,
    slide_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
```

The PPT itself is stored in R2.

D1 stores metadata and the R2 object key.

---

# 6.2 slides

```sql
CREATE TABLE slides (
    id TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL,
    slide_number INTEGER NOT NULL,
    title TEXT,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY (presentation_id)
        REFERENCES presentations(id),

    UNIQUE(presentation_id, slide_number)
);
```

Important:

`summary` is mandatory for the POC.

The admin manually enters the summary for each slide.

Example:

```text
Slide 3
Title:
Proposed Architecture

Summary:
Frontend communicates with the Worker API,
which persists data in D1 and manages real-time
communication through Durable Objects.
```

---

# 6.3 feedback_rules

Use one rule per slide.

```sql
CREATE TABLE feedback_rules (
    id TEXT PRIMARY KEY,
    slide_id TEXT NOT NULL UNIQUE,

    enabled INTEGER NOT NULL DEFAULT 0,
    required INTEGER NOT NULL DEFAULT 0,

    feedback_type TEXT NOT NULL,

    question TEXT,

    options_json TEXT,

    allow_resubmission INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (slide_id)
        REFERENCES slides(id)
);
```

Allowed feedback types:

```text
disabled
boolean
multiple_choice
open_text
```

Example:

```json
{
  "enabled": true,
  "required": true,
  "feedbackType": "multiple_choice",
  "question": "How clear was this section?",
  "options": [
    "Very clear",
    "Clear",
    "Neutral",
    "Confusing"
  ],
  "allowResubmission": false
}
```

---

# 6.4 presentation_sessions

```sql
CREATE TABLE presentation_sessions (
    id TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL,

    session_code TEXT NOT NULL UNIQUE,

    status TEXT NOT NULL,

    current_slide_number INTEGER,

    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,

    FOREIGN KEY (presentation_id)
        REFERENCES presentations(id)
);
```

Allowed status:

```text
draft
live
ended
```

No QR payload is required.

---

# 6.5 participants

```sql
CREATE TABLE participants (
    id TEXT PRIMARY KEY,

    session_id TEXT NOT NULL,

    name TEXT NOT NULL,
    email TEXT NOT NULL,

    joined_at TEXT NOT NULL,

    FOREIGN KEY (session_id)
        REFERENCES presentation_sessions(id),

    UNIQUE(session_id, email)
);
```

The same participant should be able to reconnect after refreshing the page.

---

# 6.6 feedback_responses

```sql
CREATE TABLE feedback_responses (
    id TEXT PRIMARY KEY,

    session_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    slide_id TEXT NOT NULL,

    feedback_type TEXT NOT NULL,
    question TEXT,

    response_value TEXT,

    submitted_at TEXT NOT NULL,

    FOREIGN KEY (session_id)
        REFERENCES presentation_sessions(id),

    FOREIGN KEY (participant_id)
        REFERENCES participants(id),

    FOREIGN KEY (slide_id)
        REFERENCES slides(id),

    UNIQUE(participant_id, slide_id)
);
```

For the POC, this means one current response per participant per slide.

If resubmission is allowed:

```text
existing response
      ↓
UPDATE
```

If resubmission is not allowed:

```text
existing response
      ↓
REJECT
```

---

# 7. PPT Upload

The admin uploads:

```text
presentation.pptx
```

The Worker should:

1. Validate file extension.
2. Validate reasonable file size.
3. Generate a presentation UUID.
4. Upload the original PPT to R2.
5. Create the presentation record in D1.
6. Determine the number of slides.

## Important POC simplification

Do not build server-side visual PPT rendering.

Cloudflare Workers are not the appropriate environment for running LibreOffice-style rendering.

Instead, the POC should support one of these approaches:

### Preferred POC approach

The admin provides the slide count and manually configures each slide.

Example:

```text
Upload:
presentation.pptx

Number of slides:
5
```

Then the admin configures:

```text
Slide 1 → Summary + Feedback Rule
Slide 2 → Summary + Feedback Rule
Slide 3 → Summary + Feedback Rule
Slide 4 → Summary + Feedback Rule
Slide 5 → Summary + Feedback Rule
```

The actual PPT remains stored in R2 for future use.

Later, a dedicated preprocessing pipeline can generate slide images if actual visual fidelity becomes a requirement.

---

# 8. Admin Configuration Flow

The admin should have a simple slide configuration screen.

Example:

```text
Presentation: Product Demo

-----------------------------------

Slide 1

Title:
Introduction

Summary:
Welcome to the product demonstration.

Feedback:
[ Disabled ]

-----------------------------------

Slide 2

Title:
Problem

Summary:
The current process requires manual work.

Feedback:
[ Enabled ]

Type:
[ Yes / No ]

Question:
Was the problem clear?

Required:
[ Yes ]

Resubmission:
[ No ]

-----------------------------------

Slide 3

Title:
Solution

Summary:
Our solution automates the process.

Feedback:
[ Enabled ]

Type:
[ Multiple Choice ]

Question:
How useful is this solution?

Options:
[ Very Useful ]
[ Useful ]
[ Neutral ]
[ Not Useful ]

Required:
[ Yes ]

Resubmission:
[ Yes ]
```

The configuration is saved to D1.

---

# 9. Session Creation

Once configuration is complete:

```text
Create Presentation Session
```

The Worker generates a unique session code.

Example:

```text
ABX729
```

Session code requirements:

- 6 characters
- Uppercase
- Easy to type
- Avoid ambiguous characters where possible
- Unique among active/recent sessions

Example alphabet:

```text
ABCDEFGHJKLMNPQRSTUVWXYZ23456789
```

Exclude:

```text
0 O
1 I
```

The admin sees:

```text
Presentation Ready

Session Code:

ABX729

Share this code with participants.
```

No QR code.

---

# 10. User Join Flow

User opens the application.

```text
Join Presentation

Name
[ Ashutosh ]

Email
[ ashutosh@example.com ]

Session Code
[ ABX729 ]

[ Join ]
```

Backend:

```text
POST /api/sessions/ABX729/join
```

Request:

```json
{
  "name": "Ashutosh",
  "email": "ashutosh@example.com"
}
```

Response:

```json
{
  "participantId": "...",
  "sessionCode": "ABX729",
  "status": "live",
  "currentSlide": 3
}
```

The frontend then opens the WebSocket connection.

---

# 11. Real-Time Synchronization

Use:

```text
Cloudflare Worker
        +
Durable Object
        +
WebSocket
```

WebSocket:

```text
/ws/session/ABX729
```

The Durable Object represents:

```text
PresentationSession: ABX729
```

Connected clients:

```text
Admin
User A
User B
User C
...
```

When the admin moves to the next slide:

```text
PATCH /api/sessions/ABX729/slide
```

Request:

```json
{
  "slideNumber": 4
}
```

Worker:

```text
1. Validate admin
2. Validate session is LIVE
3. Validate slide exists
4. Update D1 current_slide_number
5. Notify PresentationSession Durable Object
6. Durable Object broadcasts event
```

Broadcast:

```json
{
  "type": "SLIDE_CHANGED",
  "slideNumber": 4
}
```

The user receives this event and requests or receives the corresponding slide data.

---

# 12. WebSocket Message Design

Keep the POC protocol small.

## Server → Client

### SLIDE_CHANGED

```json
{
  "type": "SLIDE_CHANGED",
  "slideNumber": 4
}
```

The client then fetches:

```text
GET /api/sessions/ABX729/slides/4
```

or the Worker can include the full slide payload.

Preferred POC approach: include the slide and rule directly to reduce round trips.

```json
{
  "type": "SLIDE_CHANGED",
  "slide": {
    "slideNumber": 4,
    "title": "Architecture",
    "summary": "The system uses Workers, D1, R2 and Durable Objects."
  },
  "feedbackRule": {
    "enabled": true,
    "required": true,
    "type": "multiple_choice",
    "question": "How clear was this architecture?",
    "options": [
      "Very clear",
      "Clear",
      "Neutral",
      "Confusing"
    ],
    "allowResubmission": false
  }
}
```

### SESSION_ENDED

```json
{
  "type": "SESSION_ENDED"
}
```

---

# 13. User Feedback Validation

Never trust frontend validation.

The Worker must validate every response against the rule stored in D1.

## Disabled

```text
enabled = false
```

Reject feedback.

---

## Required

If:

```text
required = true
```

and the response is empty:

```text
400 Bad Request
```

---

## Boolean

Allowed values:

```text
yes
no
```

Anything else is rejected.

---

## Multiple Choice

The response must exactly match one of:

```text
options_json
```

---

## Open Text

Validate:

- Not empty if required
- Maximum length
- Basic input size limits

For example:

```text
max 2000 characters
```

---

# 14. Resubmission Logic

This is an explicit business rule.

When feedback is submitted:

```text
Does response already exist?
```

### No existing response

Create response.

### Existing response + resubmission disabled

Reject:

```json
{
  "error": "RESUBMISSION_NOT_ALLOWED"
}
```

### Existing response + resubmission enabled

Update the existing response.

Example:

```text
Previous:
"Useful"

New:
"Very Useful"
```

Database result:

```text
One response
Current value = "Very Useful"
```

Do not create duplicate records for a resubmission in this POC.

---

# 15. Admin Presentation Controls

The admin needs only basic controls:

```text
[ Start Presentation ]

Current Slide: 3

[ ← Previous ]   [ Next → ]

[ End Presentation ]
```

When started:

```text
status = live
current_slide_number = 1
```

When ended:

```text
status = ended
ended_at = current timestamp
```

After ending:

- No new feedback
- No slide changes
- Existing feedback remains available
- Export remains available

---

# 16. Export

The admin can select:

```text
Export Feedback
```

Endpoint:

```text
GET /api/sessions/{code}/export
```

Return JSON.

Example:

```json
{
  "session": {
    "code": "ABX729",
    "presentation": "Product Demo",
    "status": "ended"
  },
  "feedback": [
    {
      "slideNumber": 2,
      "user": {
        "name": "Ashutosh",
        "email": "ashutosh@example.com"
      },
      "question": "Was the problem clear?",
      "feedbackType": "boolean",
      "response": "yes",
      "submittedAt": "2026-08-21T18:30:42Z"
    },
    {
      "slideNumber": 3,
      "user": {
        "name": "Ashutosh",
        "email": "ashutosh@example.com"
      },
      "question": "How useful was the solution?",
      "feedbackType": "multiple_choice",
      "response": "Very Useful",
      "submittedAt": "2026-08-21T18:31:15Z"
    }
  ]
}
```

No analytics are required.

---

# 17. API Surface

Keep the API intentionally small.

## Presentations

```text
POST /api/presentations
POST /api/presentations/{id}/upload
GET  /api/presentations/{id}
```

## Slides

```text
GET  /api/presentations/{id}/slides
PUT  /api/presentations/{id}/slides/{slideNumber}
```

The PUT operation should allow the admin to update:

- Title
- Summary
- Feedback rule

## Sessions

```text
POST  /api/sessions
GET   /api/sessions/{code}
POST  /api/sessions/{code}/start
PATCH /api/sessions/{code}/slide
POST  /api/sessions/{code}/end
GET   /api/sessions/{code}/export
```

## Participants

```text
POST /api/sessions/{code}/join
```

## Feedback

```text
POST /api/sessions/{code}/feedback
GET  /api/sessions/{code}/feedback/me
```

## WebSocket

```text
GET /ws/session/{code}
```

---

# 18. Cloudflare Bindings

The Worker should have bindings similar to:

```json
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "live-feedback-db",
      "database_id": "..."
    }
  ],

  "r2_buckets": [
    {
      "binding": "PRESENTATION_BUCKET",
      "bucket_name": "live-feedback-presentations"
    }
  ],

  "durable_objects": {
    "bindings": [
      {
        "name": "PRESENTATION_SESSION",
        "class_name": "PresentationSession"
      }
    ]
  }
}
```

Use Wrangler configuration appropriate to the current Cloudflare Workers runtime.

Do not hardcode resource IDs in application code.

---

# 19. Secrets and Cloudflare Credentials

The Cloudflare API token provided during planning is a **mock token**.

Do not place it in:

- Git
- `plan.md`
- source code
- `wrangler.jsonc`
- frontend code
- API requests committed to the repository
- `.env.example`

When the real token is provided, store it using Cloudflare/Wrangler secret management or the appropriate MCP connection configuration.

Example concept:

```text
wrangler secret put CLOUDFLARE_API_TOKEN
```

Do not expose the token to the browser.

The frontend must never receive Cloudflare API credentials.

---

# 20. Cloudflare MCP

The project will use a Cloudflare MCP integration supplied separately by the user.

The MCP should be used for Cloudflare-specific infrastructure operations where available, such as:

- Inspecting Workers
- Managing D1
- Managing R2
- Managing Durable Objects
- Inspecting deployments
- Checking configuration
- Verifying resources

The MCP endpoint/credentials should be treated as infrastructure credentials, not application configuration.

The provided mock token is only a placeholder and must not be assumed to be valid.

---

# 21. Local Development

Use Wrangler for local Cloudflare-compatible development.

Recommended local services:

```text
Frontend
   ↓
Wrangler dev
   ↓
Worker
   ├── local D1
   ├── local R2
   └── local Durable Object
```

Do not introduce Docker/PostgreSQL as the primary local architecture.

The local environment should resemble the eventual Cloudflare deployment as closely as possible.

---

# 22. Frontend

Recommended frontend:

```text
React + TypeScript
```

The frontend should communicate with:

```text
Worker REST API
+
Worker WebSocket
```

Main screens:

## Admin

```text
/login

/admin/presentations
/admin/presentations/:id/configure
/admin/sessions/:code
/admin/sessions/:code/results
```

## User

```text
/join
/session/:code
```

---

# 23. Admin Configuration UI

The configuration UI should be simple rather than trying to build a full PowerPoint editor.

Example:

```text
┌───────────────────────────────────────────────┐
│ Product Demo                                  │
├───────────────────────────────────────────────┤
│                                               │
│ Slide 1                                       │
│ ┌───────────────────────────────────────────┐ │
│ │ Title: Introduction                      │ │
│ │                                           │ │
│ │ Summary:                                  │ │
│ │ [ Welcome to the presentation...       ] │ │
│ │                                           │ │
│ │ Feedback: [ Disabled ▼ ]                 │ │
│ └───────────────────────────────────────────┘ │
│                                               │
│ Slide 2                                       │
│ ┌───────────────────────────────────────────┐ │
│ │ Title: Problem                           │ │
│ │                                           │ │
│ │ Summary:                                  │ │
│ │ [ Current process is manual...          ] │ │
│ │                                           │ │
│ │ Feedback: [ Multiple Choice ▼ ]          │ │
│ │ Question: [ How clear was this?        ] │ │
│ │                                           │ │
│ │ Required:       [✓]                      │ │
│ │ Resubmission:   [ ]                      │ │
│ │                                           │ │
│ │ Options:                                  │ │
│ │ [ Very clear ]                            │ │
│ │ [ Clear ]                                 │ │
│ │ [ Confusing ]                             │ │
│ └───────────────────────────────────────────┘ │
│                                               │
│             [ Save Configuration ]            │
└───────────────────────────────────────────────┘
```

---

# 24. User Presentation UI

The user should see a simple interface:

```text
┌──────────────────────────────────────────────┐
│ Product Demo                     Slide 3/8   │
├──────────────────────────────────────────────┤
│                                              │
│              Slide 3                         │
│                                              │
│  Proposed Architecture                       │
│                                              │
│  The system uses Workers, D1, R2 and        │
│  Durable Objects for the POC.                │
│                                              │
├──────────────────────────────────────────────┤
│ Feedback                                     │
│                                              │
│ How clear was this architecture?             │
│                                              │
│ ○ Very clear                                 │
│ ○ Clear                                      │
│ ○ Neutral                                    │
│ ○ Confusing                                  │
│                                              │
│                [ Submit ]                    │
└──────────────────────────────────────────────┘
```

When the admin changes the slide, this screen updates automatically.

---

# 25. POC Security

Do not build a complex authentication system.

However, enforce basic boundaries.

## Admin

Admin operations must be protected.

For the POC, this can be a simple admin authentication mechanism.

Possible approach:

```text
Admin login
   ↓
Session/token
   ↓
Protected admin API
```

Do not expose admin APIs publicly without authorization.

## Users

Users authenticate to a presentation using:

```text
name
email
session code
```

This is sufficient for the POC.

Do not build user accounts/passwords yet.

---

# 26. Cloudflare-Specific Constraints

The implementation must respect Workers runtime constraints.

Avoid assuming a traditional server environment.

Do not use:

```text
FastAPI
PostgreSQL
SQLAlchemy
Alembic
Redis server
Docker-only services
Long-running Python processes
Filesystem-based persistence
```

Use Cloudflare-native equivalents:

```text
FastAPI          → Cloudflare Worker
PostgreSQL       → D1
SQLAlchemy       → D1 queries / lightweight DB layer
Alembic          → Wrangler D1 migrations
Redis Pub/Sub    → Durable Objects
Local filesystem → R2
Server WebSocket → Durable Objects WebSocket
```

If a dependency requires Node/Python native server functionality that is unavailable in Workers, prefer a Cloudflare-compatible alternative.

---

# 27. Important Data Flow

## Admin starts presentation

```text
Admin Browser
     │
     │ POST /sessions/ABX729/start
     ▼
Cloudflare Worker
     │
     ├── Update D1
     │      status = live
     │      current_slide = 1
     │
     └── Notify Durable Object
                 │
                 ▼
          Connected Clients
```

## Admin changes slide

```text
Admin
  │
  │ PATCH /sessions/ABX729/slide
  │ { slideNumber: 3 }
  ▼
Worker
  │
  ├── Validate
  ├── Update D1
  └── Notify Durable Object
              │
              ▼
       WebSocket Broadcast
              │
       ┌──────┼──────┐
       ▼      ▼      ▼
     User A User B User C
```

## User submits feedback

```text
User
  │
  │ POST /sessions/ABX729/feedback
  ▼
Worker
  │
  ├── Validate session
  ├── Validate participant
  ├── Load slide rule from D1
  ├── Validate response
  ├── Check resubmission rule
  └── INSERT / UPDATE D1
```

---

# 28. Build Order

Build the POC in the following order.

## Phase 1 — Cloudflare Foundation

- Create Worker project
- Configure Wrangler
- Configure local development
- Create D1 database
- Create R2 bucket
- Create Durable Object
- Verify Worker deployment
- Verify bindings

Success condition:

```text
Worker → D1
Worker → R2
Worker → Durable Object
```

all work.

---

## Phase 2 — Database

Create D1 migrations for:

```text
presentations
slides
feedback_rules
presentation_sessions
participants
feedback_responses
```

Test:

- Create presentation
- Create slides
- Save feedback rules
- Create session
- Join participant
- Store feedback

---

## Phase 3 — PPT Upload

Implement:

```text
POST /api/presentations
```

Upload PPT to R2.

Store:

```text
presentation ID
filename
R2 object key
slide count
```

Do not implement slide rendering.

---

## Phase 4 — Slide Configuration

Implement:

```text
PUT /api/presentations/{id}/slides/{slideNumber}
```

Admin can configure:

- Title
- Summary
- Feedback enabled
- Feedback type
- Question
- Options
- Required
- Allow resubmission

---

## Phase 5 — Session Management

Implement:

```text
POST /api/sessions
POST /api/sessions/{code}/start
PATCH /api/sessions/{code}/slide
POST /api/sessions/{code}/end
GET /api/sessions/{code}
```

Verify session state survives Worker restarts.

---

## Phase 6 — User Join

Implement:

```text
POST /api/sessions/{code}/join
```

Collect:

```text
name
email
session code
```

Return participant/session information.

---

## Phase 7 — Durable Object + WebSockets

Implement:

```text
PresentationSession Durable Object
```

Support:

```text
connect
disconnect
broadcast
```

Test with:

```text
1 Admin browser
2+ User browser tabs
```

When admin changes slide, all users must update automatically.

---

## Phase 8 — Feedback

Implement:

```text
POST /api/sessions/{code}/feedback
```

Validate:

- Enabled
- Required
- Type
- Options
- Resubmission
- Session status

Test each feedback type.

---

## Phase 9 — Export

Implement:

```text
GET /api/sessions/{code}/export
```

Return structured JSON.

Verify:

```text
User
↓
Slide
↓
Question
↓
Response
```

is always preserved.

---

## Phase 10 — Frontend

Build:

### Admin

- Upload presentation
- Configure slides
- Create session
- Display session code
- Start
- Previous
- Next
- End
- Export JSON

### User

- Join
- Enter name/email
- Enter code
- View current slide
- View feedback form
- Submit feedback
- Receive slide changes automatically

---

# 29. POC Acceptance Test

The POC is complete when this exact scenario works.

### Admin

1. Login.
2. Upload `demo.pptx`.
3. Configure 5 slides.
4. Enter a summary for each slide.
5. Disable feedback for Slide 1.
6. Configure Yes/No feedback for Slide 2.
7. Configure multiple-choice feedback for Slide 3.
8. Configure open-ended feedback for Slide 4.
9. Configure Slide 5 with resubmission disabled.
10. Create session.
11. Receive:

```text
ABX729
```

### User

12. Open the website.
13. Enter:

```text
Ashutosh
ashutosh@example.com
ABX729
```

14. Join session.
15. See Slide 1 summary.
16. Admin moves to Slide 2.
17. User automatically sees Slide 2.
18. User sees Yes/No feedback.
19. User submits "Yes".
20. Admin moves to Slide 3.
21. User automatically sees Slide 3.
22. User sees multiple-choice feedback.
23. User submits response.
24. Admin moves through remaining slides.
25. User submits feedback where allowed.
26. Attempt resubmission on a slide where it is disabled.
27. Backend rejects the submission.
28. Admin ends presentation.
29. Admin exports JSON.
30. JSON contains all collected responses correctly mapped to users and slides.

---

# 30. Explicitly Out of Scope

Do not build these during the POC:

- QR codes
- Advanced analytics
- Charts
- AI analysis
- Sentiment analysis
- Word clouds
- Leaderboards
- Gamification
- User accounts
- Complex RBAC
- Organization/tenant management
- Presentation editing
- Actual PowerPoint visual rendering
- Video streaming
- Recording
- Chat
- Reactions
- Comments
- Notifications
- Email delivery
- Advanced reporting
- Redis
- PostgreSQL
- Kubernetes
- Docker-based production infrastructure

---

# 31. Future Extensions

Once the POC proves the core interaction, the architecture should allow future additions.

Potential next steps:

```text
Actual slide rendering
        ↓
Video presentations
        ↓
Advanced analytics
        ↓
AI feedback analysis
        ↓
Presentation insights
        ↓
Multiple presenters
        ↓
Organizations
        ↓
Multiple concurrent sessions
        ↓
Large-scale audience support
```

The current Cloudflare architecture should provide a strong foundation for these extensions.

---

# 32. Final Architecture Summary

The POC should be built around this model:

```text
                    CLOUDFLARE

       ┌──────────────────────────────────┐
       │          React Frontend          │
       │        Pages / Static Assets     │
       └────────────────┬─────────────────┘
                        │
                 HTTPS / WebSocket
                        │
                        ▼
       ┌──────────────────────────────────┐
       │       Cloudflare Worker          │
       │                                  │
       │ REST API + Validation + Business │
       │ Logic + Export                   │
       └──────────┬───────────┬───────────┘
                  │           │
                  ▼           ▼
        ┌──────────────┐  ┌──────────────┐
        │      D1      │  │      R2      │
        │              │  │              │
        │ App data     │  │ PPT files    │
        └──────────────┘  └──────────────┘

                        │
                        ▼
             ┌──────────────────────┐
             │   Durable Object     │
             │                      │
             │ Presentation Session │
             │                      │
             │ WebSocket connections│
             │ Real-time broadcast  │
             └──────────────────────┘
```

## Core principle

**D1 stores what happened.**

**R2 stores the presentation artifact.**

**Durable Objects coordinate what is happening right now.**

**Workers execute the application's business logic.**

**React provides the admin and participant interfaces.**

The POC should remain focused on proving one thing extremely well:

> **When an admin controls a live presentation, every connected participant immediately sees the same current slide and the feedback experience configured for that slide, and all responses can be exported as structured JSON.**
