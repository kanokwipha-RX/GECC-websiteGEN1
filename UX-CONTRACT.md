# GECC behavior contract

Apache/PHP target uses the same client and behavior contract through the shared
apiUrl adapter with PHP query routes. PHP/MariaDB owns authorization, validation,
score summaries, sessions and durable writes. The release excludes development
sources, credentials and attachments from the public directory; installation is
guarded and disabled after completion. Node test results do not certify PHP.

Canonical owners: index.html shell/go (navigation), .inp/native inputs/select/date
(forms), openModal/closeModal (dialogs), toast/#toasts (feedback), .tbl-wrap/table
(tabular data), assets/premium.css (global scrollbar/focus), assets/motion.js
(motion). No table-selection UI is introduced. Locale is th-TH with Buddhist year
display, preserving existing date helpers and ISO storage dates.

Navigation must respect unsaved-change confirmation. Rendering cannot discard a
draft. Success is announced only after durable save. API failure leaves a visible
retry/reload warning and the local draft intact, never a silent local fallback.

Local mode is enabled only by the local preview server's GECC_PREVIEW injection;
it preserves incumbent browser data and demo PINs and is explicitly labelled.
Static hosting and production default to server mode and fail closed if the API
is unavailable. All API/file requests use the application base path.
Server mode starts empty/public, never reads local records,
never seeds demo assessments and never honors demo hash login. Session and resource
permissions are server authoritative. Public assessment statistics are aggregates.
Public chart counts and update timestamps come from summary, never fabricated
unit records. Application schedules use Asia/Bangkok (+07:00); timeline dates keep
their original ISO calendar date. PHP encoding repair belongs to the coordinator
settings workflow: preview, revision/CSRF check, private snapshot, atomic write,
append-only audit. It never changes passwords or role/resource scopes.

Organization: own assessment/evidence and defect responses; cannot edit scores,
reviewer feedback or locked records. Reviewer: assigned group, score/review/return/
reopen. Coordinator: all groups, settings and accounts. Locked assessments require
explicit reopen reason. Server generates audit actor/timestamps and workflow logs.

New async actions retain button geometry and disable repeats while pending.
Session expiry and version conflict must stop save; explicit reload requires
confirmation if a draft is dirty. Import never silently overwrites existing data.
