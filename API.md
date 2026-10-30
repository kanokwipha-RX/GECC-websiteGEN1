# GECC same-origin API

PHP/MariaDB target: the release client maps these logical paths to
/sskgecc/api/index.php?route=... (for example route=session or route=files%2Fid).
Request methods, JSON bodies, scoped responses, CSRF and workflow semantics remain
the same. PHP uses PDO/InnoDB, Argon2id password hashes, database-backed login
throttling and a one-time guarded installer; see PHP-DEPLOYMENT-TH.md.
The PostgreSQL/Node implementation described below remains an alternative runtime.

All responses are JSON except static assets and authenticated binary downloads.
Errors use `{ "error": "Thai recovery message" }`. Sessions are HttpOnly cookies;
the session response supplies a CSRF token held in browser memory. Mutations require
the exact configured Origin plus `X-CSRF-Token` (login requires Origin only).

| Endpoint | Behavior |
|---|---|
| GET /api/health | 200 when initialized data/database are ready; otherwise 503 |
| POST /api/session | username/password; rotates session; no public signup |
| GET /api/session | user and CSRF or null; never returns password hashes |
| DELETE /api/session | revoke current session |
| POST /api/password | current/password; changes hash and revokes all sessions |
| GET /api/state | `{state, revision, summary}` scoped to authenticated resources |
| PUT /api/state | `{state, revision}`; validates and atomically merges the visible legacy aggregate |
| GET /api/summary | aggregate counts only; no per-unit scores or evidence |
| POST /api/workflow/:unitId | `{revision, action, note?, sender?}`; submit/review/return/reopen |
| PUT /api/files/:id | binary body, `X-Unit-Id`, URL-encoded `X-File-Name`; 10 MB maximum |
| GET /api/files/:id | permission-checked PDF/image with sandbox/no-store headers |
| GET/POST /api/accounts | coordinator list/create; organization username comes from its six-digit code |
| PATCH /api/accounts/:id | coordinator active/password reset; sessions revoked |
| GET /api/audit | coordinator latest 100 append-only application events |
| POST /api/import/preview | coordinator `{state,revision}`; counts and missing attachment IDs |
| POST /api/import | same payload; empty target and complete file references required |
| POST /api/admin/reset | coordinator `{revision,mode}`; assessments or official roster reset after UI confirmation |

The state API is an adapter for the incumbent synchronous, whole-document UI; it
does not grant write access to every supplied field. Each organization/assessment/
defect is authorized server-side. A missing assessment in a snapshot does not delete
it. Administrative reset is a separate explicit operation. All writes use a locked
PostgreSQL transaction and expected revision. A stale revision returns 409 without
overwriting the newer document. The browser keeps a failed draft and provides an
explicit reload and draft-download recovery path.

Organization accounts cannot edit physical/checklist/outcome scores, reviewer
feedback, inspector identity or readiness verification (matching the incumbent
read-only score controls). They can supply narrative/evidence/readiness/survey
data and defect responses for their own organization. Reviewers can act only in
their assigned group. Reviewed assessments require an explicit reasoned reopen.
Incomplete submissions remain allowed, matching the old application's warning.

Workflow timestamps/log actor are generated on the server. Scoring formulas are
shared unchanged in shared/criteria.js. Existing imported inspection names remain
business data; the audit separately records the authenticated actor.

Public output explicitly selects public metadata plus aggregates; it does not
return assessment documents for the frontend to hide. Library links remain external
Google Drive navigation; the application does not change Drive permissions.

State records preserve the original JSON shape in versioned JSONB. Account/session/
file/audit tables have relational constraints. This deliberate compatibility choice
avoids rewriting the incumbent criteria/workflow while adding an authoritative
server boundary. A global revision favors correctness over concurrent edit merging
at the current 28-organization scale.

## PHP Content v2 endpoints

All routes below use /sskgecc/api/index.php?route=ROUTE.

| Route | Methods | Access and data |
|---|---|---|
| public/units | GET | Explicit public per-unit status/score projection; no evidence, narrative or reviewer notes |
| public/content | GET | Published albums/videos, committee and advisors; no Library links |
| public/media/:id | GET | Only images referenced by published albums or public persons |
| admin/content | GET, PUT | Coordinator; PUT {revision,content,teams?}; existing CSRF/session/revision enforcement |
| admin/media | POST | Coordinator + CSRF, binary JPEG/PNG/WebP <=8 MB; returns {src} for a content reference |
| library | GET, POST, DELETE | POST {password} requires same-origin; rate limited, HttpOnly cookie; GET requires valid cookie; DELETE revokes cookie |

Content albums: {title,date,description,status,images:[{src,alt}]} with ISO dates and ordered image arrays. Videos: {title,category,url,status}; categories physical/highlight/activity and status draft/published. No schema replacement is required: content migration version 2 extends the existing publicContent document with a private snapshot first.
